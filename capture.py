#!/usr/bin/env python3
"""capture.py — record Granny's story from the Vexo band.

Owner: Person 1 (band + demo loop). See CLAUDE.md section 7.1.

Usage:
    python3 capture.py <band_number> --id <memory_id> [--sim]
    python3 capture.py --from-file story.wav --id <memory_id>   # fallback
    python3 capture.py --transcript "text" --id <memory_id>     # fallback

Writes: memories/<id>/audio.wav and memories/<id>/transcript.txt

BEFORE WRITING BAND CODE, read (do not guess library calls):
    vexo-open-kit/AGENTS.md
    vexo-open-kit/docs/api.md
    vexo-open-kit/examples/README.md
    vexo-open-kit/examples/python/audio_to_text.py
"""

# TODO (Person 1): implement. Base this on examples/python/audio_to_text.py.
