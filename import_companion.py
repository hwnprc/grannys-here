#!/usr/bin/env python3
"""import_companion.py — bring companion/ memories into the family pipeline.

The companion app (companion/, Person 1) records on the band with real GPS and
exports before-i-forget-memories.json. This turns each of its memories into a
memories/<id>/ folder the viewer, family page and demo loop understand.

    python3 import_companion.py ~/Downloads/before-i-forget-memories.json
    python3 import_companion.py <file> --dry-run
    python3 import_companion.py <file> --only <uuid> --id sunday-park --location park

Writes, per memory:  memories/<id>/transcript.txt
                     memories/<id>/memory.json
                     memories/index.json  (so family.html lists it)

Two things it deliberately does NOT do:

* It never sets approved: true. The companion is a self-recording tool with no
  family gate; this pipeline has one (CLAUDE.md section 1). An imported memory
  stays invisible to the band until someone approves it in family.html or with
  `process.py <id> --approve`.
* It never invents a transcript. originalText comes across verbatim.

The companion keeps no audio — it streams Opus straight to Deepgram and holds
only counters — so there is no audio.wav to import. Record that with
`capture.py 25 --id <id> --text no`.

With --world it goes straight on to build each place in 3D from what she actually
said, so a story told into the band becomes somewhere you can walk, with no
hand-written prompt and no OpenAI key:

    python3 import_companion.py <file> --world --draft

Afterwards:  process.py <id>        fills summary/emotion/sensitive/scene_prompt
             place_to_world.py <id> builds the 3D world
"""
import argparse
import datetime
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MEMORIES = ROOT / "memories"
OK, BAD, DOT = "✓", "✗", "·"

# location_key is what demo.py matches a keypress on.
KEY_WORDS = {"park": "park", "lake": "park", "garden": "park", "kitchen": "kitchen",
             "home": "kitchen", "house": "kitchen", "church": "church",
             "chapel": "church", "cafe": "cafe", "café": "cafe"}


def slugify(text, fallback):
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return (s[:40].rstrip("-") or fallback)


def location_key(place_name):
    low = (place_name or "").lower()
    for word, key in KEY_WORDS.items():
        if word in low:
            return key
    return slugify(place_name, "place").split("-")[0]


def convert(mem, override_id=None, override_location=None):
    conv = mem.get("conversation") or {}
    place = mem.get("place") or {}
    text = (conv.get("originalText") or "").strip()
    name = (place.get("name") or "").strip()

    when = mem.get("createdAt") or conv.get("occurredAt")
    created = (datetime.datetime.fromtimestamp(when / 1000).astimezone().isoformat()
               if isinstance(when, (int, float)) else None)

    mid = override_id or slugify(name, mem.get("id", "memory")[:8])
    excerpt = (mem.get("excerpt") or "").strip()
    person = (mem.get("person") or "").strip()

    out = {
        "id": mid,
        "title": name or "A remembered conversation",
        "summary": excerpt,
        "transcript": text,
        "people": [person] if person else [],
        "place_name": name,
        "place_type": None,
        "location_key": override_location or location_key(name),
        "time_period": None,
        "season": None,
        "emotion": None,
        "sensitive": False,
        "approved": False,          # the family gate: never bypassed on import
        "intro_line": (mem.get("reminder") or "").strip(),
        "scene_prompt": None,       # process.py writes this
        # Real coordinates from the companion's GPS fix — the part the
        # keyboard trigger stands in for.
        "location": {
            "lat": place.get("lat"),
            "lon": place.get("lon"),
            "accuracy_m": place.get("accuracy"),
            "radius_m": mem.get("radius"),
            "source": place.get("coordinateSource"),
        },
        "source": "companion",
        "source_id": mem.get("id"),
        "files": {"audio": "audio.wav", "intro": "intro.mp3", "pano": None, "world": None},
        "created_at": created,
    }
    return mid, text, out


def main():
    ap = argparse.ArgumentParser(description="Import companion memories.")
    ap.add_argument("export_file", help="before-i-forget-memories.json")
    ap.add_argument("--dry-run", action="store_true", help="show what would be written")
    ap.add_argument("--only", help="import just this companion memory id")
    ap.add_argument("--id", help="memory id to write under (single import only)")
    ap.add_argument("--location", help="override location_key (park, kitchen, church)")
    ap.add_argument("--force", action="store_true", help="overwrite an existing memory.json")
    ap.add_argument("--world", action="store_true",
                    help="after importing, build each memory's 3D world from what she said "
                         "(runs place_to_world.py; about 5 minutes each)")
    ap.add_argument("--draft", action="store_true", help="with --world: faster, cheaper worlds")
    args = ap.parse_args()

    path = Path(args.export_file).expanduser()
    if not path.is_file():
        sys.exit("%s no such file: %s" % (BAD, path))
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        sys.exit("%s %s is not valid JSON: %s" % (BAD, path, e))

    memories = data.get("memories")
    if not isinstance(memories, list):
        sys.exit("%s no \"memories\" list — is this a companion export?" % BAD)
    if args.only:
        memories = [m for m in memories if m.get("id") == args.only]
        if not memories:
            sys.exit("%s no memory with id %s in that file" % (BAD, args.only))
    if args.id and len(memories) > 1:
        sys.exit("%s --id needs --only: that file holds %d memories" % (BAD, len(memories)))

    print("%s %d memor%s in %s" % (DOT, len(memories), "y" if len(memories) == 1 else "ies", path.name))
    written = []

    for mem in memories:
        mid, text, out = convert(mem, args.id, args.location)
        folder = MEMORIES / mid
        target = folder / "memory.json"

        if target.exists() and not args.force:
            print("%s %-22s already exists — skipped (use --force)" % (DOT, mid))
            continue
        if args.dry_run:
            print("%s %-22s would write %s  (at %s, location_key=%s)"
                  % (DOT, mid, target.relative_to(ROOT), out["place_name"], out["location_key"]))
            continue

        folder.mkdir(parents=True, exist_ok=True)
        (folder / "transcript.txt").write_text(text + "\n")
        target.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
        written.append(mid)
        print("%s %-22s %s  (%s)" % (OK, mid, out["place_name"], out["location_key"]))

    if args.dry_run or not written:
        return

    index = MEMORIES / "index.json"
    ids = []
    if index.is_file():
        try:
            ids = (json.loads(index.read_text()) or {}).get("memories") or []
        except json.JSONDecodeError:
            pass
    for mid in written:
        if mid not in ids:
            ids.append(mid)
    index.write_text(json.dumps({"memories": ids}, indent=2) + "\n")
    print("%s index.json now lists %d memories" % (OK, len(ids)))

    if args.world:
        import subprocess
        for mid in written:
            print("\n%s building the world for %s from her own words..." % (DOT, mid))
            cmd = ["python3", str(ROOT / "place_to_world.py"), mid]
            if args.draft:
                cmd.append("--draft")
            if subprocess.call(cmd) != 0:
                print("%s world generation failed for %s (the memory is still imported)" % (BAD, mid))

    print("\nImported memories are NOT approved: the band will not offer them yet.")
    print("Next:  python3 process.py %s --approve --location %s"
          % (written[0], (args.location or "park")))
    print("       python3 capture.py 25 --id %s --text no      (her voice: not in the export)"
          % written[0])


if __name__ == "__main__":
    main()
