"""Audio analysis endpoint hosted on Modal.

Deploy:  modal deploy modal/audio_analysis.py
Iterate: modal serve  modal/audio_analysis.py

Returns the JSON shape defined in audio_core.analyze_bytes.
"""

from __future__ import annotations

from typing import Any

import modal

app = modal.App("music-video-studio-audio")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(
        "librosa==0.10.2.post1",
        "soundfile==0.12.1",
        "numpy<2",
        "scipy==1.13.1",
        "httpx==0.27.2",
        # Modal >=1.0 no longer auto-installs FastAPI for fastapi_endpoint
        # functions — add it explicitly. `fastapi[standard]` pulls in the
        # extras the modal endpoint runtime expects.
        "fastapi[standard]==0.119.1",
    )
    .add_local_python_source("audio_core")
)


@app.function(image=image, timeout=300, cpu=2.0, memory=4096)
@modal.fastapi_endpoint(method="POST")
def analyze(payload: dict[str, Any]) -> dict[str, Any]:
    import httpx
    from audio_core import analyze_bytes

    url = payload["url"]
    # `sections=0` (default) means auto-pick from duration in audio_core.
    sections_k = int(payload.get("sections", 0))

    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        audio_bytes = r.content

    return analyze_bytes(audio_bytes, sections_k)
