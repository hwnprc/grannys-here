#!/usr/bin/env python3
"""atlas.py — generate a 3D world for a memory with World Labs.

Standalone on purpose: process.py belongs to Person 2, so this stays out of
their way. `process.py --atlas` can shell out to it later.

Usage:
    python3 atlas.py <memory_id>                 # photo + scene_prompt
    python3 atlas.py <memory_id> --text-only     # scene_prompt alone
    python3 atlas.py <memory_id> --dry-run       # show the request, send nothing
    python3 atlas.py <memory_id> --model marble-1.1-plus   # bigger outdoor world

Reads  memories/<id>/memory.json  (scene_prompt, title)
       memories/<id>/photos/*.jpg (first photo, unless --text-only)
Writes memories/<id>/pano.jpg     (panorama backdrop for web/viewer.html)
       memories/<id>/world.json   (full API response, for debugging)
       memories/<id>/memory.json  (adds world_id, world_url, files.pano)

API (docs.worldlabs.ai/api, verified 2026-11-14):
    POST /marble/v1/media-assets:prepare_upload  -> media_asset id + signed URL
    PUT  <signed upload_url>                     -> the image bytes
    POST /marble/v1/worlds:generate              -> operation_id
    GET  /marble/v1/operations/{id}              -> poll until done
    Header: WLT-Api-Key

    image_prompt is an OBJECT, not a string: either
      {"source": "uri", "uri": "https://..."} for a public URL, or
      {"source": "media_asset", "media_asset_id": "..."} after uploading.
    Sending base64 is rejected with HTTP 422.
    Generation takes about 5 minutes and needs a FUNDED account.
    The response contains splats, a GLB mesh, a panorama and world_marble_url.
    There is no mp4 — see CLAUDE.md section 6.
"""

import argparse
import base64
import json
import os
import sys
import time
from pathlib import Path

import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

API_ROOT = "https://api.worldlabs.ai/marble/v1"
GENERATE = API_ROOT + "/worlds:generate"
OPERATION = API_ROOT + "/operations/{}"
PREPARE_UPLOAD = API_ROOT + "/media-assets:prepare_upload"

OK, BAD, DOT = "✓", "✗", "·"


def say(mark, msg):
    print("%s %s" % (mark, msg), flush=True)


def die(msg):
    say(BAD, msg)
    sys.exit(1)


def memory_dir(memory_id):
    d = Path("memories") / memory_id
    if not d.is_dir():
        die("No such memory: %s" % d)
    return d


def load_memory(d):
    f = d / "memory.json"
    if not f.is_file():
        die("%s not found. Run process.py first." % f)
    try:
        return json.loads(f.read_text())
    except json.JSONDecodeError as e:
        die("%s is not valid JSON: %s" % (f, e))


def pick_photo(d):
    """First usable reference photo, or None."""
    photos = d / "photos"
    if not photos.is_dir():
        return None
    for p in sorted(photos.iterdir()):
        if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
            return p
    return None


def resize(path, max_edge):
    """Image bytes, downscaled if Pillow is around. Returns (bytes, extension)."""
    raw = path.read_bytes()
    ext = "png" if path.suffix.lower() == ".png" else "jpg"

    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(raw))
        if max(img.size) > max_edge:
            img.thumbnail((max_edge, max_edge), Image.LANCZOS)
            buf = io.BytesIO()
            img.convert("RGB").save(buf, "JPEG", quality=90)
            raw, ext = buf.getvalue(), "jpg"
            say(DOT, "resized to %dx%d (%.1f MB)" % (img.size[0], img.size[1],
                                                     len(raw) / 1e6))
    except ImportError:
        say(DOT, "Pillow not installed — sending the photo at full size. "
                 "`pip install pillow` if the upload is rejected as too large.")

    return raw, ext


def upload_asset(path, key, max_edge):
    """prepare_upload -> PUT the bytes -> media_asset_id."""
    raw, ext = resize(path, max_edge)

    try:
        r = requests.post(PREPARE_UPLOAD, headers=headers(key), timeout=60, json={
            "file_name": path.name, "kind": "image", "extension": ext,
        })
    except requests.RequestException as e:
        die("Could not reach World Labs to prepare the upload: %s" % e)

    if r.status_code in (401, 403):
        die("World Labs rejected the key (HTTP %d) on prepare_upload." % r.status_code)
    if not r.ok:
        die("prepare_upload failed (HTTP %d): %s" % (r.status_code, r.text[:400]))

    data = r.json()
    ma = data.get("media_asset") or {}
    # The live API returns media_asset_id; the docs example shows id. Accept both.
    asset_id = ma.get("media_asset_id") or ma.get("id")
    info = data.get("upload_info") or {}
    url, method = info.get("upload_url"), (info.get("upload_method") or "PUT").upper()
    if not (asset_id and url):
        die("prepare_upload gave no upload URL: %s" % json.dumps(data)[:400])

    try:
        up = requests.request(method, url, data=raw, timeout=300,
                              headers=info.get("required_headers") or {})
    except requests.RequestException as e:
        die("Upload failed: %s" % e)
    if not up.ok:
        die("Upload failed (HTTP %d): %s" % (up.status_code, up.text[:300]))

    say(OK, "uploaded photo as media asset %s" % asset_id)
    return asset_id


def build_prompt(mem, image_ref, text_only):
    text = (mem.get("scene_prompt") or "").strip()
    if not text and image_ref is None:
        die("No scene_prompt and no usable photo; nothing to send.")

    if text_only or image_ref is None:
        return {"type": "text", "text_prompt": text}

    # The photo fixes the geometry; the prompt carries season and mood.
    prompt = {"type": "image", "image_prompt": image_ref, "is_pano": False}
    if text:
        prompt["text_prompt"] = text
    return prompt


def headers(key):
    return {"WLT-Api-Key": key, "Content-Type": "application/json"}


def generate(body, key, timeout):
    try:
        r = requests.post(GENERATE, headers=headers(key), json=body, timeout=timeout)
    except requests.RequestException as e:
        die("Could not reach World Labs: %s" % e)

    if r.status_code in (401, 403):
        die("World Labs rejected the key (HTTP %d). Check WORLDLABS_API_KEY, and "
            "that the account has credits." % r.status_code)
    if r.status_code == 402:
        die("World Labs says the account is out of credits (HTTP 402). Buy credits "
            "on the billing page, then re-run.")
    if not r.ok:
        die("Generate failed (HTTP %d): %s" % (r.status_code, r.text[:400]))

    op = r.json()
    if not op.get("operation_id"):
        die("No operation_id in the response: %s" % json.dumps(op)[:400])
    return op["operation_id"]


def poll(operation_id, key, timeout, interval):
    waited, last = 0, None
    while waited < timeout:
        try:
            r = requests.get(OPERATION.format(operation_id), headers=headers(key),
                             timeout=30)
        except requests.RequestException as e:
            say(DOT, "poll hiccup (%s); retrying" % e)
            time.sleep(interval); waited += interval
            continue

        if not r.ok:
            die("Poll failed (HTTP %d): %s" % (r.status_code, r.text[:400]))

        op = r.json()
        if op.get("error"):
            die("World generation failed: %s" % json.dumps(op["error"])[:400])
        if op.get("done"):
            return op

        status = (op.get("metadata") or {}).get("progress", {}).get("status")
        if status and status != last:
            say(DOT, "%s (%ds elapsed)" % (status, waited))
            last = status

        time.sleep(interval); waited += interval

    die("Timed out after %ds. The world may still finish — check operation %s."
        % (timeout, operation_id))


def save_pano(url, dest, force):
    if dest.exists() and not force:
        say(DOT, "%s already exists; leaving it (use --force to replace)." % dest)
        return dest.name
    try:
        r = requests.get(url, timeout=120)
        r.raise_for_status()
    except requests.RequestException as e:
        say(BAD, "Could not download the panorama: %s" % e)
        return None
    dest.write_bytes(r.content)
    say(OK, "saved %s (%.1f MB)" % (dest, len(r.content) / 1e6))
    return dest.name


def shrink_pano(path, max_edge):
    """The API panorama is huge; the viewer needs a web-sized one."""
    try:
        from PIL import Image
    except ImportError:
        say(DOT, "Pillow not installed — leaving the panorama full size.")
        return
    img = Image.open(path)
    if max(img.size) <= max_edge:
        return
    full = path.with_name("pano-full.jpg")          # git-ignored; original kept locally
    if not full.exists():
        path.rename(full)
        img = Image.open(full)
    img.thumbnail((max_edge, max_edge), Image.LANCZOS)
    img.convert("RGB").save(path, "JPEG", quality=86, optimize=True)
    say(OK, "web panorama %dx%d (%.1f MB); full size kept as %s"
        % (img.size[0], img.size[1], path.stat().st_size / 1e6, full.name))


def main():
    ap = argparse.ArgumentParser(description="Generate a 3D world for a memory.")
    ap.add_argument("memory_id")
    ap.add_argument("--text-only", action="store_true",
                    help="send scene_prompt alone, ignoring photos/")
    ap.add_argument("--image-uri",
                    help="use a public image URL instead of uploading photos/")
    ap.add_argument("--model", default="marble-1.1",
                    help="marble-1.1 (default), marble-1.1-plus for big outdoor scenes")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the request and exit; needs no API key")
    ap.add_argument("--force", action="store_true", help="overwrite an existing pano")
    ap.add_argument("--public", action="store_true",
                    help="make the world viewable by anyone with the link. Permission can "
                         "ONLY be set at creation — there is no update endpoint — so a "
                         "private world must be regenerated to share it.")
    ap.add_argument("--pano-edge", type=int, default=2560,
                    help="web panorama long edge (default 2560)")
    ap.add_argument("--max-edge", type=int, default=2048,
                    help="downscale the photo to this long edge (default 2048)")
    ap.add_argument("--timeout", type=int, default=900, help="poll timeout, seconds")
    ap.add_argument("--interval", type=int, default=10, help="poll interval, seconds")
    args = ap.parse_args()

    d = memory_dir(args.memory_id)
    mem = load_memory(d)
    photo = None if (args.text_only or args.image_uri) else pick_photo(d)

    key = os.environ.get("WORLDLABS_API_KEY")
    if not key and not args.dry_run:
        die("WORLDLABS_API_KEY is not set. Put it in .env (never commit it). "
            "The account also needs purchased credits.")

    # Resolve the image reference: a public URL, or a freshly uploaded asset.
    image_ref = None
    if args.image_uri:
        say(DOT, "reference image: %s" % args.image_uri)
        image_ref = {"source": "uri", "uri": args.image_uri}
    elif photo:
        say(DOT, "reference photo: %s" % photo)
        image_ref = {"source": "media_asset",
                     "media_asset_id": "<uploaded at run time>" if args.dry_run
                     else upload_asset(photo, key, args.max_edge)}
    elif not args.text_only:
        say(DOT, "No photo in photos/ — falling back to the prompt alone.")

    body = {
        "display_name": (mem.get("title") or args.memory_id)[:64],
        "model": args.model,
        "world_prompt": build_prompt(mem, image_ref, args.text_only),
    }
    if args.public:
        # Judges open the link on their own laptops; a private world shows
        # "You don't have permission to view this world".
        body["permission"] = {"public": True}

    if args.dry_run:
        print(json.dumps(body, indent=2, ensure_ascii=False))
        say(OK, "dry run — nothing sent.")
        return

    say(DOT, "generating with %s — this takes about 5 minutes" % args.model)
    operation_id = generate(body, key, timeout=120)
    say(OK, "operation %s" % operation_id)

    op = poll(operation_id, key, args.timeout, args.interval)
    world = op.get("response") or {}
    assets = world.get("assets") or {}

    (d / "world.json").write_text(json.dumps(world, indent=2) + "\n")
    say(OK, "saved %s/world.json" % d)

    # The live API returns world_id; the docs example shows id. Accept both.
    world_id = world.get("world_id") or world.get("id")
    world_url = world.get("world_marble_url")

    pano_url = (assets.get("imagery") or {}).get("pano_url")
    pano_name = save_pano(pano_url, d / "pano.jpg", args.force) if pano_url else None
    if pano_name:
        shrink_pano(d / "pano.jpg", args.pano_edge)
    if not pano_url:
        say(DOT, "no panorama in the response; the viewer will use the link alone.")

    mem["world_id"] = world_id
    mem["world_url"] = world_url
    mem.setdefault("files", {})["pano"] = pano_name
    (d / "memory.json").write_text(json.dumps(mem, indent=2, ensure_ascii=False) + "\n")
    say(OK, "updated memory.json (world_id, world_url, files.pano)")

    if world_url:
        say(OK, "walk through it: %s" % world_url)
    say(OK, "viewer: http://localhost:8000/web/viewer.html?id=%s" % args.memory_id)


if __name__ == "__main__":
    main()
