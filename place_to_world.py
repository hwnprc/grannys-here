"""Turn a memory's place into a realistic, explorable 3D world.

    python3 place_to_world.py sunday-park                 use memories/sunday-park/memory.json
    python3 place_to_world.py sunday-park --draft         faster, cheaper test world
    python3 place_to_world.py sunday-park --dry-run       find the photo + build the prompt, no API call
    python3 place_to_world.py --place "Stow Lake, San Francisco" --prompt "..." --id test

What it does:
    1. Finds a REAL photo of the place:
         - uses memories/<id>/photos/* if the family added one (best), otherwise
         - searches Wikimedia Commons (free-licensed photos) for place_name
       and saves it to photos/ with photos/CREDITS.txt (author + licence, for the README).
    2. Builds a prompt: the memory's scene_prompt + "photorealistic" guidance.
    3. Sends photo + prompt to the World Labs Marble API (image -> world).
    4. Polls until the world is ready (a few minutes), then saves into memories/<id>/:
         pano.jpg           the world's panorama (files.pano: viewer.html shows it)
         world.spz          the explorable 3D splat (files.splat)
         world_thumb.jpg    a preview image
       and adds world_url (the walkable Marble world, opened from the viewer) to memory.json.

Needs WORLDLABS_API_KEY in .env (from the World Labs Platform: API credits are separate
from Marble app credits). Standard library + requests, and pillow if installed (it scales
the photo under the API's 10 MB inline limit and the panorama down to a web-sized file).
"""
import argparse
import base64
import json
import os
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
API = "https://api.worldlabs.ai/marble/v1"
UA = {"User-Agent": "GrannysHere/0.1 (VexoHacks hackathon project)"}   # Wikimedia asks for one
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp")
MAX_INLINE_EDGE = 2048      # source=data_base64 is capped at 10 MB; a phone photo goes past it
MAX_PANO_EDGE = 2560        # the API panorama is ~4600px / 17 MB, far too heavy for viewer.html
REALISM = ("Photorealistic, like a real photograph taken at this real place, natural lighting, "
           "true-to-life materials and vegetation. Keep the real landmarks of the photo.")


# ---------------------------------------------------------------- helpers
def load_env():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def strip_html(text):
    import re
    return re.sub(r"<[^>]+>", "", text or "").strip()


# ---------------------------------------------------------------- 1. real photo
def local_photo(folder):
    photos = folder / "photos"
    if photos.is_dir():
        for p in sorted(photos.iterdir()):
            if p.suffix.lower() in IMAGE_EXT:
                return p
    return None


def wikimedia_photo(place, folder):
    """Search Wikimedia Commons for a wide, high-resolution, free-licensed photo of the place."""
    params = {
        "action": "query", "format": "json", "generator": "search",
        "gsrsearch": "%s filetype:bitmap" % place, "gsrnamespace": 6, "gsrlimit": 20,
        "prop": "imageinfo", "iiprop": "url|size|extmetadata|mime", "iiurlwidth": 2048,
    }
    r = requests.get("https://commons.wikimedia.org/w/api.php", params=params, headers=UA, timeout=20)
    r.raise_for_status()
    pages = (r.json().get("query") or {}).get("pages") or {}
    candidates = []
    for page in pages.values():
        info = (page.get("imageinfo") or [{}])[0]
        if info.get("mime") not in ("image/jpeg", "image/png", "image/webp"):
            continue
        w, h = info.get("width", 0), info.get("height", 0)
        if w < 1200 or w < h:                       # want wide, landscape shots
            continue
        meta = info.get("extmetadata") or {}
        candidates.append({
            "title": page.get("title", ""),
            "url": info.get("thumburl") or info.get("url"),
            "page": info.get("descriptionurl", ""),
            "author": strip_html((meta.get("Artist") or {}).get("value", "unknown")),
            "license": strip_html((meta.get("LicenseShortName") or {}).get("value", "see page")),
            "score": w * h,
        })
    if not candidates:
        return None, None
    best = max(candidates, key=lambda c: c["score"])
    photos = folder / "photos"
    photos.mkdir(parents=True, exist_ok=True)
    ext = os.path.splitext(best["url"].split("?")[0])[1].lower() or ".jpg"
    path = photos / ("place" + (ext if ext in IMAGE_EXT else ".jpg"))
    img = requests.get(best["url"], headers=UA, timeout=60)
    img.raise_for_status()
    path.write_bytes(img.content)
    credit = "%s by %s, %s, via Wikimedia Commons (%s)" % (best["title"].replace("File:", ""),
                                                           best["author"], best["license"], best["page"])
    (photos / "CREDITS.txt").write_text(credit + "\n", encoding="utf-8")
    return path, credit


# ---------------------------------------------------------------- 2-4. Marble API
def inline_image(photo):
    """The photo as base64, scaled down first.

    Inline data is capped at 10 MB and base64 adds a third, so anything over about
    7.5 MB on disk fails. Our Stow Lake photo is 6.6 MB -> 8.8 MB encoded: it fits,
    but only just, and a photo straight off a phone would not.
    """
    raw = photo.read_bytes()
    ext = photo.suffix.lower().lstrip(".")
    ext = "jpg" if ext == "jpeg" else ext
    try:
        import io

        from PIL import Image
        img = Image.open(io.BytesIO(raw))
        if max(img.size) > MAX_INLINE_EDGE:
            img.thumbnail((MAX_INLINE_EDGE, MAX_INLINE_EDGE), Image.LANCZOS)
            buf = io.BytesIO()
            img.convert("RGB").save(buf, "JPEG", quality=90, optimize=True)
            raw, ext = buf.getvalue(), "jpg"
            print("· photo scaled to %dx%d (%.1f MB) for the 10 MB inline limit"
                  % (img.size[0], img.size[1], len(raw) / 1e6))
    except ImportError:
        if len(raw) * 4 / 3 > 9.5e6:
            sys.exit("✗ the photo is %.1f MB and base64 would pass the API's 10 MB inline "
                     "limit. Run: python3 -m pip install pillow" % (len(raw) / 1e6))
    return base64.b64encode(raw).decode("ascii"), ext


def shrink_pano(path):
    """The panorama arrives at full resolution; the viewer needs a web-sized one."""
    try:
        from PIL import Image
    except ImportError:
        print("· pillow not installed: panorama left at full size (%.1f MB)"
              % (path.stat().st_size / 1e6))
        return
    img = Image.open(path)
    if max(img.size) <= MAX_PANO_EDGE:
        return
    full = path.with_name("pano-full.jpg")      # git-ignored; kept locally
    if full.exists():
        full.unlink()                           # a rerun must not keep the old world's copy
    path.rename(full)
    img = Image.open(full)
    img.thumbnail((MAX_PANO_EDGE, MAX_PANO_EDGE), Image.LANCZOS)
    img.convert("RGB").save(path, "JPEG", quality=86, optimize=True)
    print("· panorama scaled to %dx%d (%.1f MB); full size kept as %s"
          % (img.size[0], img.size[1], path.stat().st_size / 1e6, full.name))


def generate_world(key, photo, prompt, name, model, public, recaption=False):
    # No photo: Marble builds the place from the words alone. Raw speech is
    # recaptioned (it turns a rambling story into a scene); a crafted
    # scene_prompt is sent as written.
    if photo is None:
        world_prompt = {"type": "text", "text_prompt": prompt}
        if not recaption:
            world_prompt["disable_recaption"] = True
    else:
        data_b64, ext = inline_image(photo)
        world_prompt = {
            "type": "image",
            "text_prompt": prompt,
            "disable_recaption": not recaption,
            "image_prompt": {"source": "data_base64", "data_base64": data_b64, "extension": ext},
            "is_pano": "auto",
        }
    body = {
        "display_name": name[:64],
        "model": model,
        "permission": {"public": public},
        "world_prompt": world_prompt,
    }
    r = requests.post(API + "/worlds:generate", json=body, headers={"WLT-Api-Key": key}, timeout=120)
    if r.status_code == 402:
        sys.exit("✗ World Labs says: not enough API credits. Buy credits on the World Labs Platform "
                 "(app credits do not count for the API).")
    if r.status_code >= 400:
        sys.exit("✗ World Labs error %d: %s" % (r.status_code, r.text[:500]))
    return r.json()["operation_id"]


def wait_for(key, operation_id, limit=20 * 60):
    start = time.time()
    while time.time() - start < limit:
        r = requests.get(API + "/operations/" + operation_id, headers={"WLT-Api-Key": key}, timeout=30)
        r.raise_for_status()
        op = r.json()
        if op.get("error"):
            sys.exit("✗ generation failed: %s" % op["error"])
        if op.get("done"):
            return op["response"]
        progress = (op.get("metadata") or {}).get("progress")
        print("  ... generating%s (%ds)" % (" %s%%" % progress if progress is not None else "",
                                           time.time() - start))
        time.sleep(10)
    sys.exit("✗ still not done after %d minutes. Check the Marble app; operation %s" % (limit // 60, operation_id))


def pick_spz(spz_urls):
    """Prefer a mid/high resolution that still loads fast in a browser."""
    if not spz_urls:
        return None
    for want in ("500k", "1m", "full", "high", "100k"):
        for k, url in spz_urls.items():
            if want in k.lower():
                return url
    return next(iter(spz_urls.values()))


def download(url, path):
    r = requests.get(url, timeout=300)
    r.raise_for_status()
    path.write_bytes(r.content)
    return path


# ---------------------------------------------------------------- main
def main():
    p = argparse.ArgumentParser(description="Place -> real photo -> Marble 3D world.")
    p.add_argument("id", nargs="?", help="memory id (folder in memories/)")
    p.add_argument("--place", help="place name, if there is no memory.json yet")
    p.add_argument("--prompt", help="scene description, if there is no memory.json yet")
    p.add_argument("--draft", action="store_true", help="use marble-1.0-draft (faster, cheaper)")
    p.add_argument("--model", default="marble-1.1")
    p.add_argument("--private", action="store_true", help="do not make the world viewable by link")
    p.add_argument("--dry-run", action="store_true", help="find photo + build prompt only")
    a = p.parse_args()

    mem_id = a.id or "test"
    folder = ROOT / "memories" / mem_id
    folder.mkdir(parents=True, exist_ok=True)
    mem_path = folder / "memory.json"
    memory = json.loads(mem_path.read_text(encoding="utf-8")) if mem_path.exists() else {"id": mem_id}

    place = a.place or memory.get("place_name")
    # Her own words are the fallback prompt. process.py writes a crafted
    # scene_prompt when OpenAI is available; without it, what she actually said
    # describes the place far better than "a realistic view of X".
    spoken = (memory.get("transcript") or "").strip()
    if not spoken:
        t = folder / "transcript.txt"
        spoken = t.read_text(encoding="utf-8").strip() if t.is_file() else ""

    scene = a.prompt or memory.get("scene_prompt")
    raw_speech = False
    if not scene and spoken:
        scene, raw_speech = spoken, True
    if not scene and place:
        scene = "A realistic view of %s." % place
    if not scene:
        sys.exit("✗ nothing to build from: add a transcript, or pass --place and --prompt")
    if not place:
        place = "this place"
    print("📍 Place: %s" % place)
    if raw_speech:
        print("· no scene_prompt — building the place from her own words")

    # 1. real photo
    photo, credit = local_photo(folder), None
    if photo:
        print("✓ using family photo: %s" % photo)
        credit = memory.get("photo_credit") or "Family photo"  # see photos/SOURCES.md
    else:
        print("🔎 searching Wikimedia Commons for a real photo of %s ..." % place)
        try:
            photo, credit = wikimedia_photo(place, folder)
        except requests.RequestException as problem:
            print("✗ photo search failed: %s" % problem)
        if photo:
            print("✓ saved %s\n  credit: %s" % (photo, credit))
        else:
            print("· no photo found for this place — building from the words alone")

    # 2. prompt
    # Without a photo there are no landmarks to keep: say so, or the model is
    # told to preserve something that was never sent.
    guidance = REALISM if photo else (
        "Photorealistic, like a real photograph of this real place, natural light, "
        "true-to-life materials and textures.")
    prompt = "%s %s" % (scene.strip()[:3500], guidance)
    print("📝 Prompt: %s" % prompt)
    if a.dry_run:
        print("(dry run: no world generated)")
        return

    # 3-4. Marble
    load_env()
    key = os.environ.get("WORLDLABS_API_KEY", "").strip()
    if not key:
        sys.exit("✗ add WORLDLABS_API_KEY=... to .env")
    model = "marble-1.0-draft" if a.draft else a.model
    print("🌍 Sending photo + prompt to Marble (%s) ..." % model)
    op_id = generate_world(key, photo, prompt, memory.get("title") or place, model,
                           not a.private, raw_speech)
    print("  operation: %s" % op_id)
    world = wait_for(key, op_id)

    assets = world.get("assets") or {}
    memory["world_url"] = world.get("world_marble_url")
    memory["world_id"] = world.get("world_id")
    memory["world_semantics"] = (assets.get("splats") or {}).get("semantics_metadata")
    if credit and credit != "Family photo":
        memory["photo_credit"] = credit
    files = memory.setdefault("files", {})

    pano = (assets.get("imagery") or {}).get("pano_url")
    if pano:
        try:
            download(pano, folder / "pano.jpg")
            shrink_pano(folder / "pano.jpg")
            files["pano"] = "pano.jpg"            # viewer.html shows this full-bleed
            print("✓ saved panorama: %s" % (folder / "pano.jpg"))
        except requests.RequestException as problem:
            print("✗ panorama download failed: %s" % problem)
    spz = pick_spz((assets.get("splats") or {}).get("spz_urls") or {})
    if spz:
        try:
            download(spz, folder / "world.spz")
            files["splat"] = "world.spz"          # explorable 3D file (files.world stays the video fallback)
            print("✓ saved 3D splat: %s" % (folder / "world.spz"))
        except requests.RequestException as problem:
            print("✗ splat download failed: %s" % problem)
    thumb = assets.get("thumbnail_url")
    if thumb:
        try:
            download(thumb, folder / "world_thumb.jpg")
            files["thumbnail"] = "world_thumb.jpg"
        except requests.RequestException:
            pass

    mem_path.write_text(json.dumps(memory, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("✓ updated %s" % mem_path)
    print("🌍 Walk around it: %s" % memory["world_url"])


if __name__ == "__main__":
    main()
