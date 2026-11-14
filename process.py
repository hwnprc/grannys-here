#!/usr/bin/env python3
"""process.py — turn a transcript into a structured memory + a gentle spoken intro.

Owner: Person 2 (AI pipeline + web). See CLAUDE.md sections 6 and 7.2.

    python3 process.py sunday-park --location park --approve
    python3 process.py sunday-park --skip-extract        only (re)make intro.mp3
    python3 process.py sunday-park --no-voice            only (re)do the OpenAI extraction

Reads:  memories/<id>/transcript.txt  (or "transcript" in memory.json)
Writes: memories/<id>/memory.json     (merged: world_url, files.pano etc. are kept)
        memories/<id>/intro.mp3       (ElevenLabs narrator voice, NOT a clone of Granny)
        memories/index.json           (adds the id so family.html lists it)

.env needs OPENAI_API_KEY and ELEVENLABS_API_KEY.
Optional: ELEVENLABS_VOICE_ID (a warm, calm narrator), OPENAI_MODEL.
Then make the 3D world with:  python3 place_to_world.py <id>
"""
import argparse
import datetime
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
MODELS = ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"]   # first one that works on your key

FIELDS = """Return ONLY a JSON object with these keys:
  "title": short warm title (max 6 words),
  "summary": one sentence in third person about Granny ("Granny took her daughter..."),
  "people": list of people she mentions, as relationships ("her daughter"),
  "place_name": the most specific real place she names, with city if known
                ("Stow Lake, Golden Gate Park, San Francisco"),
  "place_type": one word (park, kitchen, church, school, market, home, street, beach...),
  "time_period": rough decade or life stage ("1980s", "when she was a girl"),
  "season": season if she says or implies one, else "",
  "emotion": 2-3 words for the feeling ("warm, nostalgic"),
  "sensitive": true if the memory involves death, illness, conflict, loss or anything that
               could upset her if it played without warning; otherwise false,
  "intro_line": ONE gentle second-person sentence that reminds her of the memory and ends with
                an invitation, e.g. "You used to come here with your daughter every Sunday.
                Would you like to hear that story?" Never correct, test or quiz her.
                Never mention anyone who may have died.,
  "scene_prompt": a vivid VISUAL description of the place for a 3D world generator: layout,
                  landmarks, objects, materials, light, season, weather, mood. Use only details
                  she said or that are true of the real place. No people, no text, no camera talk.
"""


def load_env():
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env")
    except ImportError:
        env = ROOT / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


# ---------------------------------------------------------------- OpenAI
def extract(transcript, model=None):
    from openai import OpenAI
    client = OpenAI()
    messages = [
        {"role": "system", "content": "You turn an older person's spoken memory into a structured, "
                                      "gentle record for her family. " + FIELDS},
        {"role": "user", "content": "Granny's words:\n\"\"\"\n%s\n\"\"\"" % transcript},
    ]
    last = None
    for name in ([model] if model else MODELS):
        try:
            r = client.chat.completions.create(model=name, messages=messages,
                                               response_format={"type": "json_object"})
            data = json.loads(r.choices[0].message.content)
            print("✓ extracted memory with %s" % name)
            return data
        except Exception as problem:            # model not available on this key: try the next
            last = problem
            print("  (%s did not work: %s)" % (name, str(problem)[:120]))
    raise RuntimeError("OpenAI extraction failed: %s" % last)


# ---------------------------------------------------------------- ElevenLabs
def pick_voice(key):
    """A calm narrator voice from the account, if ELEVENLABS_VOICE_ID is not set."""
    r = requests.get("https://api.elevenlabs.io/v1/voices", headers={"xi-api-key": key}, timeout=30)
    r.raise_for_status()
    voices = r.json().get("voices", [])
    if not voices:
        raise RuntimeError("no voices on this ElevenLabs account")
    def score(v):
        text = json.dumps(v.get("labels") or {}).lower() + " " + (v.get("description") or "").lower()
        return sum(w in text for w in ("calm", "warm", "soft", "gentle", "narration", "soothing"))
    best = max(voices, key=score)
    print("  using ElevenLabs voice: %s (set ELEVENLABS_VOICE_ID to choose another)" % best.get("name"))
    return best["voice_id"]


def speak(text, path):
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key:
        raise RuntimeError("add ELEVENLABS_API_KEY=... to .env")
    voice = os.environ.get("ELEVENLABS_VOICE_ID", "").strip() or pick_voice(key)
    r = requests.post(
        "https://api.elevenlabs.io/v1/text-to-speech/%s" % voice,
        headers={"xi-api-key": key, "accept": "audio/mpeg", "content-type": "application/json"},
        json={"text": text, "model_id": "eleven_multilingual_v2",
              "voice_settings": {"stability": 0.6, "similarity_boost": 0.75, "style": 0.2}},
        timeout=60,
    )
    if r.status_code >= 400:
        raise RuntimeError("ElevenLabs error %d: %s" % (r.status_code, r.text[:300]))
    path.write_bytes(r.content)


# ---------------------------------------------------------------- main
def main():
    p = argparse.ArgumentParser(description="Transcript -> memory.json + intro.mp3")
    p.add_argument("id", help="memory id (folder in memories/)")
    p.add_argument("--location", help="location_key the demo trigger matches (park, kitchen, church)")
    p.add_argument("--approve", action="store_true", help="family approves: may surface automatically")
    p.add_argument("--skip-extract", action="store_true", help="keep memory.json fields, only make intro.mp3")
    p.add_argument("--no-voice", action="store_true", help="do not call ElevenLabs")
    p.add_argument("--model", help="OpenAI model (default: first that works of %s)" % ", ".join(MODELS))
    a = p.parse_args()
    load_env()

    folder = ROOT / "memories" / a.id
    if not folder.is_dir():
        sys.exit("✗ no folder %s. Run capture.py first." % folder)
    mem_path = folder / "memory.json"
    memory = json.loads(mem_path.read_text(encoding="utf-8")) if mem_path.exists() else {}
    memory["id"] = a.id

    tpath = folder / "transcript.txt"
    transcript = tpath.read_text(encoding="utf-8").strip() if tpath.exists() else memory.get("transcript", "")
    if not transcript and not a.skip_extract:
        sys.exit("✗ no transcript. Run capture.py, or:  python3 capture.py --id %s --transcript \"...\"" % a.id)
    if transcript:
        memory["transcript"] = transcript

    # 1. OpenAI extraction (merged into what is already there)
    if not a.skip_extract:
        if not os.environ.get("OPENAI_API_KEY"):
            sys.exit("✗ add OPENAI_API_KEY=... to .env")
        try:
            fields = extract(transcript, a.model or os.environ.get("OPENAI_MODEL"))
        except RuntimeError as problem:
            sys.exit("✗ %s\n  memory.json was not changed." % problem)
        for k in ("title", "summary", "people", "place_name", "place_type", "time_period",
                  "season", "emotion", "sensitive", "intro_line", "scene_prompt"):
            if k in fields:
                memory[k] = fields[k]
        s = memory.get("sensitive")
        memory["sensitive"] = s.strip().lower() in ("true", "yes", "1") if isinstance(s, str) else bool(s)

    # 2. Family controls
    if a.location:
        memory["location_key"] = a.location
    memory.setdefault("location_key", memory.get("place_type", ""))
    if a.approve:
        memory["approved"] = True
    memory.setdefault("approved", False)

    files = memory.setdefault("files", {})
    files.setdefault("audio", "audio.wav")
    memory.setdefault("world_url", None)
    memory.setdefault("world_id", None)
    memory.setdefault("created_at", datetime.datetime.now().astimezone().isoformat(timespec="seconds"))

    # 3. ElevenLabs intro
    if not a.no_voice:
        intro = memory.get("intro_line")
        if not intro:
            print("✗ no intro_line, so no intro.mp3")
        else:
            try:
                speak(intro, folder / "intro.mp3")
                files["intro"] = "intro.mp3"
                print("✓ saved intro.mp3: \"%s\"" % intro)
            except (RuntimeError, requests.RequestException) as problem:
                print("✗ intro.mp3 not made: %s" % problem)
                print("  Fallback: make it on elevenlabs.io from the intro line and save it as %s"
                      % (folder / "intro.mp3"))

    mem_path.write_text(json.dumps(memory, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("✓ saved %s" % mem_path)

    # 4. family.html index
    index_path = ROOT / "memories" / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {"memories": []}
    if a.id not in index.setdefault("memories", []):
        index["memories"].append(a.id)
        index_path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")

    print("\n  %s — %s" % (memory.get("title", a.id), memory.get("place_name", "?")))
    print("  location_key: %s | approved: %s | sensitive: %s"
          % (memory.get("location_key"), memory.get("approved"), memory.get("sensitive")))
    if memory.get("sensitive"):
        print("  ⚠ sensitive: demo.py will never auto-play this one.")
    if not memory.get("world_url"):
        print("\nNext:  python3 place_to_world.py %s --draft" % a.id)


if __name__ == "__main__":
    main()
