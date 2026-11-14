#!/usr/bin/env python3
"""process.py — turn a transcript into a structured memory.

Owner: Person 2 (AI pipeline + web). See CLAUDE.md sections 6 and 7.2.

Usage:
    python3 process.py <memory_id> [--approve] [--location park] [--atlas]

Reads:  memories/<id>/transcript.txt
Writes: memories/<id>/memory.json, memories/<id>/intro.mp3
        (optional --atlas) memories/<id>/world.mp4

Steps:
    1. OpenAI (JSON output) -> title, summary, people, place_name, place_type,
       time_period, season, emotion, sensitive, intro_line, scene_prompt
    2. ElevenLabs narrator voice -> intro.mp3  (NOT a clone of Granny)
    3. Optional World Labs Atlas: photos/ + scene_prompt -> world.mp4 / splat

Defaults: approved = False unless --approve is passed.
"""

# TODO (Person 2): implement.
