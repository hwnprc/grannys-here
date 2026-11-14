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
from Marble app credits). Only uses the standard library + requests.
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
def generate_world(key, photo, prompt, name, model, public):
    ext = photo.suffix.lower().lstrip(".")
    body = {
        "display_name": name[:64],
        "model": model,
        "permission": {"public": public},
        "world_prompt": {
            "type": "image",
            "text_prompt": prompt,
            "disable_recaption": True,
            "image_prompt": {
                "source": "data_base64",
                "data_base64": base64.b64encode(photo.read_bytes()).decode("ascii"),
                "extension": "jpg" if ext == "jpeg" else ext,
            },
            "is_pano": "auto",
        },
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
    scene = a.prompt or memory.get("scene_prompt") or ("A realistic view of %s." % place if place else None)
    if not place or not scene:
        sys.exit("✗ need a place: run process.py first, or pass --place and --prompt")
    print("📍 Place: %s" % place)

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
            sys.exit("✗ no usable photo found. Put one in %s/photos/ and run again." % folder)

    # 2. prompt
    prompt = "%s %s" % (scene.strip(), REALISM)
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
    op_id = generate_world(key, photo, prompt, memory.get("title") or place, model, not a.private)
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
