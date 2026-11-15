#!/usr/bin/env python3
"""server.py — one web app: talk, then walk into the place you described.

    python3 server.py            then open http://localhost:8000/web/explore.html

Serves the repo (so viewer.html and family.html keep working) and adds a small
API so the browser never sees the World Labs key:

    POST /api/generate   {"prompt": "..."}        -> {"operation_id": ...}
    GET  /api/status/<operation_id>               -> {"done": bool, ...}

Speech-to-text happens in the browser with the Web Speech API, so this needs no
Deepgram key. The World Labs key stays here, in .env, and is never sent to the page.
"""
import json
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import requests

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

ROOT = Path(__file__).resolve().parent
API = "https://api.worldlabs.ai/marble/v1"
REALISM = ("Photorealistic, like a real photograph of this real place, natural light, "
           "true-to-life materials and vegetation.")

_jobs = {}
_lock = threading.Lock()


def key():
    k = (os.environ.get("WORLDLABS_API_KEY") or "").strip()
    if not k:
        raise RuntimeError("WORLDLABS_API_KEY is not set in .env")
    return k


def start_world(prompt, model):
    body = {
        "display_name": prompt[:60],
        "model": model,
        "permission": {"public": True},     # judges open the link on their own laptops
        "world_prompt": {"type": "text", "text_prompt": "%s %s" % (prompt, REALISM)},
    }
    r = requests.post(API + "/worlds:generate", json=body,
                      headers={"WLT-Api-Key": key()}, timeout=120)
    if r.status_code == 402:
        raise RuntimeError("World Labs is out of API credits.")
    if not r.ok:
        raise RuntimeError("World Labs error %d: %s" % (r.status_code, r.text[:200]))
    return r.json()["operation_id"]


def poll_world(operation_id):
    r = requests.get("%s/operations/%s" % (API, operation_id),
                     headers={"WLT-Api-Key": key()}, timeout=30)
    if not r.ok:
        raise RuntimeError("poll failed: HTTP %d" % r.status_code)
    op = r.json()
    if op.get("error"):
        raise RuntimeError(json.dumps(op["error"])[:200])
    if not op.get("done"):
        meta = (op.get("metadata") or {}).get("progress") or {}
        return {"done": False, "status": meta.get("status", "IN_PROGRESS")}
    world = op.get("response") or {}
    assets = world.get("assets") or {}
    return {
        "done": True,
        "world_url": world.get("world_marble_url"),
        "pano_url": (assets.get("imagery") or {}).get("pano_url"),
        "thumbnail_url": assets.get("thumbnail_url"),
        "caption": assets.get("caption"),
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/generate":
            return self._json(404, {"error": "no such endpoint"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(n) or b"{}")
            prompt = (data.get("prompt") or "").strip()
            if len(prompt) < 10:
                return self._json(400, {"error": "Say a little more about the place first."})
            model = "marble-1.0-draft" if data.get("draft") else "marble-1.1"
            op = start_world(prompt[:4000], model)
            with _lock:
                _jobs[op] = {"prompt": prompt}
            self._json(200, {"operation_id": op})
        except Exception as e:                       # noqa: BLE001 - surfaced to the page
            self._json(500, {"error": str(e)})

    def do_GET(self):
        if self.path.startswith("/api/status/"):
            op = self.path.rsplit("/", 1)[-1]
            try:
                self._json(200, poll_world(op))
            except Exception as e:                   # noqa: BLE001
                self._json(500, {"error": str(e)})
            return
        super().do_GET()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print("Granny's Here — http://localhost:%d/web/explore.html" % port)
    print("(the viewer and family pages still work on this server too)")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
