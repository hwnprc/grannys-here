"""Record one of Granny's stories from the Vexo Open band.

    python3 capture.py 42 --id sunday-park          band 42 over Bluetooth
    python3 capture.py 42 --id sunday-park --usb    band 42 on the USB cable
    python3 capture.py --sim --id test              pretend band (plays the kit's sample voice)
    python3 capture.py --id sunday-park --transcript "Every Sunday I took my daughter..."
                                                    no band at all: just save the text

Flow: the band breathes white = ready. Double-tap the band (or press Enter) to start.
While recording the light is solid blue (the microphone owns the light).
Double-tap again (or press Enter) to stop. The band flashes green = saved.

Saves into memories/<id>/:
    audio.wav        Granny's original voice (16 kHz mono), played back by demo.py
    recording.ogg    the raw recording, as the band sent it
    transcript.txt   the words, from Deepgram (needs DEEPGRAM_API_KEY in .env)

Run from the repo root, with the kit cloned at ./vexo-open-kit.
Needs:  python3 -m pip install bleak av
"""
import argparse
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
KIT = ROOT / "vexo-open-kit"
sys.path.insert(0, str(KIT / "python"))                # the band library
sys.path.insert(0, str(KIT / "examples" / "python"))   # speech.py, ogg_opus.py, kit.py

import kit                                   # noqa: E402  (also turns band errors into one-line messages)
import speech                                # noqa: E402
from ogg_opus import OggOpusWriter           # noqa: E402
from vexo_open import audio                  # noqa: E402
from vexo_open.sync import Band              # noqa: E402

READY = "#ffffff"      # breathing white: waiting for a double-tap
SAVED = "#3ddc84"      # green flash: story saved


def parse_args():
    p = argparse.ArgumentParser(description="Record a story from the Vexo band.")
    p.add_argument("number", nargs="?", type=kit.band_number, help="the number on your band, e.g. 42")
    p.add_argument("--sim", dest="transport", action="store_const", const="sim", default="ble",
                   help="pretend band, no hardware")
    p.add_argument("--usb", dest="transport", action="store_const", const="serial",
                   help="USB cable instead of Bluetooth")
    p.add_argument("--id", default="sunday-park", help="memory id = folder name in memories/")
    p.add_argument("--seconds", type=float, default=90, help="longest recording, in seconds (default 90)")
    p.add_argument("--text", default="yes", help="yes = transcribe with Deepgram; no = only save the sound")
    p.add_argument("--replay", default=None, help="with --sim: an .ogg/.opus file the pretend band plays")
    p.add_argument("--transcript", default=None, help="no band: save this text as the transcript and stop")
    a = p.parse_args()
    if a.transcript is None and a.number is None and a.transport == "ble":
        p.error("add your band number (e.g. 42), or --sim, or --transcript \"...\"")
    return a


def wait_for(trigger, band, limit=None):
    """Keep the band library running until trigger is set (or limit seconds pass)."""
    start = time.time()
    while not trigger.is_set():
        if limit is not None and time.time() - start >= limit:
            return False
        band.wait(0.1)
    return True


def main():
    args = parse_args()
    folder = ROOT / "memories" / args.id
    folder.mkdir(parents=True, exist_ok=True)

    # --- No band: save typed text only -------------------------------------------
    if args.transcript is not None:
        (folder / "transcript.txt").write_text(args.transcript.strip() + "\n", encoding="utf-8")
        print("✓ saved transcript to %s" % (folder / "transcript.txt"))
        if not (folder / "audio.wav").exists():
            print("  (no audio.wav: demo.py will play only the intro for this memory)")
        return

    # --- Speech-to-text (optional) -------------------------------------------------
    ears = None
    if args.text != "no":
        try:
            ears = speech.create()
            print("✓ speech-to-text: %s" % ears.label)
        except (speech.SpeechError, kit.VexoError) as problem:
            print("✗ no transcript this time: %s" % problem)
            print("  The sound is still saved. You can add text later with --transcript.")

    print("Loading the sound decoder... (a few seconds, once)")
    try:
        audio.PcmDecoder()       # warm up 'av' now, not after the story
    except kit.VexoError as problem:
        print("✗ %s" % problem)

    # --- Connect ---------------------------------------------------------------------
    connect_opts = {}
    if args.transport == "sim":
        connect_opts = {"audio_packets": audio.ogg_packets(args.replay or kit.SAMPLE_SPEECH)}
    else:
        print("Double-tap the band now so it can be found (blue blink)...")
    band = Band.connect(args.number, args.transport, **connect_opts)
    print("✓ connected to %s" % band.name)

    toggle = threading.Event()               # set by a double-tap or by Enter

    def on_double_tap(_e):
        toggle.set()

    def enter_listener():
        while True:
            try:
                input()
            except EOFError:
                return
            toggle.set()

    band.on("double-tap", on_double_tap)
    band.configure(events=True)
    band.set_events(kinds=["tap", "double-tap"])
    threading.Thread(target=enter_listener, daemon=True).start()

    # --- Wait to start ---------------------------------------------------------------
    band.set_led(READY, pattern="breathe", period=2500, brightness=0.6)
    print("\nReady. Double-tap the band (or press Enter) to start the story.")
    wait_for(toggle, band)
    toggle.clear()

    # --- Record ----------------------------------------------------------------------
    packets = []
    ogg = OggOpusWriter(str(folder / "recording.ogg"))
    most = int(args.seconds * 50)             # 50 packets a second

    def on_audio(a):
        if len(packets) < most:
            packets.append((a.seq, a.opus))
            ogg.write(a.seq, a.opus)
            if ears:
                ears.feed(a.opus, a.seq)

    band.on("audio", on_audio)
    if ears:
        ears.start(lambda text, final: print("  heard:", text) if final else None)
    band.configure(audio=True)                # light goes solid blue: the mic is on
    print("● Recording (light is blue). Double-tap again (or press Enter) to stop. Max %ds." % args.seconds)
    wait_for(toggle, band, limit=args.seconds)
    band.configure(audio=False)               # mic off, blue light off
    band.off("audio", on_audio)
    ogg.close()
    print("■ Stopped. %.1f s recorded (%d packets lost)." % (ogg.seconds, ogg.lost))

    # --- Saved signal ----------------------------------------------------------------
    try:
        band.set_led(SAVED, pattern="flash", period=400)
        band.wait(1.5)
        band.led_off()
    except kit.VexoError:
        pass
    band.disconnect()

    # --- Write files -----------------------------------------------------------------
    if packets:
        try:
            pcm = audio.normalise(audio.decode_packets(packets))   # a quiet voice made louder
            audio.write_wav(folder / "audio.wav", pcm)
            print("✓ saved Granny's voice to %s" % (folder / "audio.wav"))
        except kit.VexoError as problem:
            print("✗ could not make audio.wav (%s). recording.ogg is still saved." % problem)
    else:
        print("✗ no sound arrived. Was the band connected and close?")

    if ears:
        text = ears.stop().strip()
        if text:
            (folder / "transcript.txt").write_text(text + "\n", encoding="utf-8")
            print("✓ saved transcript to %s" % (folder / "transcript.txt"))
            print("  \"%s\"" % (text if len(text) < 200 else text[:200] + "..."))
        else:
            print("✗ no speech heard. Add text with:  python3 capture.py --id %s --transcript \"...\"" % args.id)

    print("\nNext:  python3 process.py %s --location park --approve" % args.id)


if __name__ == "__main__":
    main()
