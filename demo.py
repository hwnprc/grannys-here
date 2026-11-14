"""The Granny's Here demo loop.

    python3 demo.py 25            band 25 over Bluetooth
    python3 demo.py 25 --usb      band 25 on the USB cable
    python3 demo.py --sim         pretend band (it "taps" by itself every few seconds)

Before you start, in another terminal at the repo root:
    python3 -m http.server 8000 --bind 127.0.0.1

Then type a place and press Enter:
    p = arrive at the park     k = kitchen     c = church     q = quit
(or type any location_key from a memory.json)

What happens:
    1. Finds an approved, non-sensitive memory for that place in memories/*/memory.json
    2. The band breathes warm amber: "a memory is here"
    3. Tap the band = "yes"   (no tap within --timeout seconds = nothing happens)
    4. Plays intro.mp3 (the gentle narrator)
    5. Opens web/viewer.html?id=<id> (the 3D world) and plays audio.wav (Granny's voice)
    6. The light fades off

In the real product the phone's GPS triggers step 1; here the keyboard does.
"""
import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BAND = 25          # our band, Vexo-HACK-25. The pretend band uses it too:
                   # vexo-open-kit AGENTS.md rule 1 forbids the example number 42.
sys.path.insert(0, str(ROOT / "vexo-open-kit" / "python"))
sys.path.insert(0, str(ROOT / "vexo-open-kit" / "examples" / "python"))

import kit                                   # noqa: E402
from vexo_open.sync import Band              # noqa: E402

AMBER = "#ff9a3c"
KEYS = {"p": "park", "k": "kitchen", "c": "church", "h": "home"}


def parse_args():
    p = argparse.ArgumentParser(description="Granny's Here demo loop.")
    p.add_argument("number", nargs="?", type=kit.band_number, help="the number on your band, e.g. 25")
    p.add_argument("--sim", dest="transport", action="store_const", const="sim", default="ble",
                   help="pretend band, no hardware")
    p.add_argument("--usb", dest="transport", action="store_const", const="serial",
                   help="USB cable instead of Bluetooth")
    p.add_argument("--timeout", type=float, default=30, help="seconds to wait for a tap (default 30)")
    p.add_argument("--port", type=int, default=8000, help="port of the web server (default 8000)")
    p.add_argument("--no-browser", action="store_true", help="do not open the viewer")
    a = p.parse_args()
    if a.number is None and a.transport == "ble":
        p.error("add your band number (e.g. 25), or --sim for a pretend band")
    return a


def load_memories():
    found = []
    for path in sorted((ROOT / "memories").glob("*/memory.json")):
        try:
            m = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as problem:
            print("✗ skipped %s: %s" % (path, problem))
            continue
        m.setdefault("id", path.parent.name)
        m["_folder"] = path.parent
        found.append(m)
    return found


def pick(memories, location):
    """The first memory for this place that the family approved and that is not sensitive."""
    for m in memories:
        if m.get("location_key") == location and m.get("approved") and not m.get("sensitive"):
            return m
    return None


def play(path):
    """Play a sound file and wait until it ends."""
    path = str(path)
    system = platform.system()
    if system == "Darwin":
        cmd = ["afplay", path]
    elif shutil.which("ffplay"):
        cmd = ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", path]
    elif system == "Linux" and path.endswith(".wav") and shutil.which("aplay"):
        cmd = ["aplay", "-q", path]
    elif system == "Windows":
        os.startfile(path)                     # opens the default player; does not wait
        time.sleep(5)
        return
    else:
        print("✗ no audio player found for %s" % path)
        return
    try:
        subprocess.run(cmd, check=False)
    except OSError as problem:
        print("✗ could not play %s: %s" % (path, problem))


def server_up(port):
    try:
        urllib.request.urlopen("http://127.0.0.1:%d/" % port, timeout=1)
        return True
    except Exception:
        return False


def led(band, *args, **kwargs):
    try:
        band.set_led(*args, **kwargs)
    except kit.VexoError as problem:
        print("  (light: %s)" % problem)


def led_off(band):
    try:
        band.led_off()
    except kit.VexoError:
        pass


def main():
    args = parse_args()
    memories = load_memories()
    if not memories:
        print("✗ no memories found in memories/*/memory.json. Run capture.py and process.py first.")
        return
    print("Memories:")
    for m in memories:
        state = "approved" if m.get("approved") else "NOT approved"
        if m.get("sensitive"):
            state += ", sensitive (never auto-plays)"
        print("  - %-14s at %-8s (%s)  %s" % (m["id"], m.get("location_key", "?"), state, m.get("title", "")))

    if not args.no_browser and not server_up(args.port):
        print("! The viewer needs the web server. In another terminal at the repo root run:")
        print("    python3 -m http.server %d --bind 127.0.0.1" % args.port)

    if args.transport != "sim":
        print("\nDouble-tap the band now so it can be found (blue blink)...")
    band = Band.connect(args.number or BAND, args.transport)
    print("✓ connected to %s" % band.name)

    tapped = threading.Event()
    listening = threading.Event()             # only count taps while a memory is offered

    def on_tap(_e):
        if listening.is_set():
            tapped.set()

    def on_disconnect(e):
        if getattr(e, "reason", None) == "closed":     # we quit on purpose
            return
        print("\n✗ band disconnected (%s). Double-tap it and restart demo.py." % getattr(e, "reason", "?"))

    band.on("tap", on_tap)
    band.on("double-tap", on_tap)
    band.on("disconnect", on_disconnect)
    band.configure(events=True)
    band.set_events(kinds=["tap", "double-tap"])
    led_off(band)

    print("\nType a place and press Enter:  p = park, k = kitchen, c = church, q = quit")
    while True:
        try:
            typed = input("> ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            break
        if typed in ("q", "quit", "exit"):
            break
        if not typed:
            continue
        location = KEYS.get(typed, typed)
        memory = pick(memories, location)
        print("📍 Arrived at: %s" % location)
        if memory is None:
            print("  No approved memory here. The band stays quiet.")
            continue

        # 1. A memory is here: warm amber breathing
        print("  ✨ Memory nearby: \"%s\". Band glows amber. Tap the band to hear it." % memory.get("title", memory["id"]))
        led(band, AMBER, pattern="breathe", period=2500)
        tapped.clear()
        listening.set()
        start = time.time()
        while not tapped.is_set() and time.time() - start < args.timeout:
            band.wait(0.1)
        listening.clear()

        if not tapped.is_set():
            print("  No tap. Letting it go gently.")
            led_off(band)
            continue

        # 2. Yes: steady warm light, intro, then her voice with the 3D world
        print("  👆 Tap! Playing the memory.")
        led(band, AMBER, brightness=0.5)
        folder = memory["_folder"]
        files = memory.get("files", {})
        intro = folder / files.get("intro", "intro.mp3")
        voice = folder / files.get("audio", "audio.wav")

        if intro.exists():
            play(intro)
        else:
            print("  (no %s: run process.py)" % intro.name)

        if not args.no_browser:
            url = "http://localhost:%d/web/viewer.html?id=%s" % (args.port, memory["id"])
            webbrowser.open(url)
            print("  🌍 Opened %s" % url)

        if voice.exists():
            play(voice)
        else:
            print("  (no %s: record with capture.py)" % voice.name)

        led_off(band)
        print("  Done. Type another place, or q to quit.")

    led_off(band)
    band.disconnect()
    print("Bye.")


if __name__ == "__main__":
    main()
