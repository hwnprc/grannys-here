#!/usr/bin/env python3
"""demo.py — the live demo loop: arrive, glow, tap, play, open viewer.

Owner: Person 1 (band + demo loop). See CLAUDE.md section 7.3.

Usage:
    python3 demo.py <band_number> [--sim]

Keys:  p = arrive at park,  k = arrive at kitchen,  q = quit

Loop:
    arrive -> find an APPROVED, NON-SENSITIVE memory for that location_key
           -> band glows warm amber -> wait for tap (~30 s timeout)
    tap    -> play intro.mp3, then audio.wav (macOS: afplay)
           -> open http://localhost:8000/web/viewer.html?id=<id>

BEFORE WRITING BAND CODE, read vexo-open-kit/docs/api.md (see capture.py).
"""

# TODO (Person 1): implement. Keep one band connection open for the whole demo.
