"""Local FastAPI sidecar that mirrors the Modal endpoint.

Use this for dev when you don't want to deploy to Modal. Same request/response
shape as the Modal function — just point MODAL_AUDIO_URL at this server.

Run:
    cd modal
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements-local.txt
    python local_server.py            # listens on :3002

Then in your repo-root .env:
    MODAL_AUDIO_URL=http://localhost:3002
"""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure we can import audio_core even when run from outside this dir.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx
from fastapi import FastAPI
from pydantic import BaseModel

from audio_core import analyze_bytes

app = FastAPI(title="music-video-studio-audio (local)")


class AnalyzePayload(BaseModel):
    url: str
    sections: int = 0  # 0 = auto-pick from duration; positive forces a count


@app.post("/")
def analyze(payload: AnalyzePayload) -> dict:
    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        r = client.get(payload.url)
        r.raise_for_status()
        audio_bytes = r.content
    return analyze_bytes(audio_bytes, payload.sections)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=3002, log_level="info")
