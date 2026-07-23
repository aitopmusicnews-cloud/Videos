"""LTX-2.3 LipDub worker for Modal.

Deploy after creating a Modal secret named ``huggingface`` containing HF_TOKEN:

    modal secret create huggingface HF_TOKEN=hf_...
    modal deploy modal/ltx_lip_sync.py

The Hugging Face account behind the token must have access to both:
- google/gemma-3-12b-it-qat-q4_0-unquantized
- Lightricks/LTX-2.3-22b-IC-LoRA-LipDub
"""

from __future__ import annotations

import base64
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

import modal

app = modal.App("mvs-ltx-lipdub")

MODEL_DIR = Path("/models")
OUTPUT_DIR = Path("/outputs")
LTX_MODEL_DIR = MODEL_DIR / "ltx-2.3"
GEMMA_DIR = MODEL_DIR / "gemma-3-12b"
LIPDUB_DIR = MODEL_DIR / "lipdub"

CHECKPOINT_NAME = "ltx-2.3-22b-distilled-1.1.safetensors"
UPSCALER_NAME = "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"
LIPDUB_NAME = "ltx-2.3-22b-ic-lora-lipdub-0.9.safetensors"

model_volume = modal.Volume.from_name("mvs-ltx23-lipdub-models", create_if_missing=True)
output_volume = modal.Volume.from_name("mvs-ltx23-lipdub-outputs", create_if_missing=True)
hf_secret = modal.Secret.from_name("huggingface", required_keys=["HF_TOKEN"])

web_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "fastapi[standard]>=0.115.8",
)

lipdub_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("build-essential", "ffmpeg", "git")
    .pip_install(
        "uv>=0.8.0",
        "fastapi[standard]>=0.115.8",
        "httpx>=0.27.2",
        "huggingface_hub>=0.36.0",
        "hf_xet>=1.1.0",
    )
    .run_commands(
        "git clone --depth 1 https://github.com/Lightricks/LTX-2.git /opt/LTX-2",
        "cd /opt/LTX-2 && uv pip install --system -e packages/ltx-core -e packages/ltx-pipelines",
    )
    .env(
        {
            "HF_HOME": str(MODEL_DIR),
            "HF_HUB_CACHE": str(MODEL_DIR / "hub"),
            "HF_XET_HIGH_PERFORMANCE": "1",
            "TOKENIZERS_PARALLELISM": "false",
            "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
        }
    )
)


def _run(command: list[str], *, timeout: int | None = None) -> None:
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if completed.stdout:
        print(completed.stdout)
    if completed.stderr:
        print(completed.stderr)
    if completed.returncode != 0:
        tail = (completed.stderr or completed.stdout or "unknown command failure")[-6000:]
        raise RuntimeError(f"Command failed ({completed.returncode}): {tail}")


def _safe_filename(value: Any, default: str) -> str:
    candidate = Path(str(value or default)).name
    return candidate or default


def _write_media(payload: dict[str, Any], kind: str, work_dir: Path) -> Path:
    encoded = payload.get(f"{kind}_base64")
    remote_url = payload.get(f"{kind}_url")
    default_suffix = ".mp4" if kind == "video" else ".wav"
    filename = _safe_filename(payload.get(f"{kind}_filename"), f"{kind}{default_suffix}")
    if not Path(filename).suffix:
        filename += default_suffix
    target = work_dir / filename

    if encoded:
        try:
            raw = base64.b64decode(str(encoded), validate=True)
        except Exception as error:  # noqa: BLE001
            raise ValueError(f"Invalid {kind}_base64 payload") from error
        if not raw:
            raise ValueError(f"{kind}_base64 payload is empty")
        target.write_bytes(raw)
        return target

    if not remote_url:
        raise ValueError(f"{kind}_url or {kind}_base64 is required")

    import httpx

    with httpx.stream("GET", str(remote_url), follow_redirects=True, timeout=180.0) as response:
        response.raise_for_status()
        with target.open("wb") as handle:
            for chunk in response.iter_bytes():
                handle.write(chunk)
    if not target.is_file() or target.stat().st_size == 0:
        raise RuntimeError(f"Downloaded {kind} is empty")
    return target


def _send_webhook(webhook_url: str | None, payload: dict[str, Any]) -> None:
    if not webhook_url:
        return
    import httpx

    try:
        response = httpx.post(webhook_url, json=payload, timeout=30.0)
        response.raise_for_status()
    except Exception as error:  # noqa: BLE001
        print(f"[LipDub webhook] callback failed: {error}")


@app.cls(
    image=lipdub_image,
    gpu="A100-80GB",
    cpu=16.0,
    memory=131072,
    timeout=7200,
    scaledown_window=300,
    secrets=[hf_secret],
    volumes={str(MODEL_DIR): model_volume, str(OUTPUT_DIR): output_volume},
)
class LipDubRunner:
    @modal.enter()
    def prepare_models(self) -> None:
        from huggingface_hub import hf_hub_download, snapshot_download

        token = os.environ.get("HF_TOKEN")
        if not token:
            raise RuntimeError("HF_TOKEN is missing from the Modal 'huggingface' secret")

        LTX_MODEL_DIR.mkdir(parents=True, exist_ok=True)
        GEMMA_DIR.mkdir(parents=True, exist_ok=True)
        LIPDUB_DIR.mkdir(parents=True, exist_ok=True)
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        print("[LTX-2.3 LipDub] Ensuring model files are cached...")
        self.checkpoint_path = Path(
            hf_hub_download(
                repo_id="Lightricks/LTX-2.3",
                filename=CHECKPOINT_NAME,
                local_dir=str(LTX_MODEL_DIR),
                token=token,
            )
        )
        self.upsampler_path = Path(
            hf_hub_download(
                repo_id="Lightricks/LTX-2.3",
                filename=UPSCALER_NAME,
                local_dir=str(LTX_MODEL_DIR),
                token=token,
            )
        )
        self.lipdub_path = Path(
            hf_hub_download(
                repo_id="Lightricks/LTX-2.3-22b-IC-LoRA-LipDub",
                filename=LIPDUB_NAME,
                local_dir=str(LIPDUB_DIR),
                token=token,
            )
        )
        snapshot_download(
            repo_id="google/gemma-3-12b-it-qat-q4_0-unquantized",
            local_dir=str(GEMMA_DIR),
            token=token,
        )
        model_volume.commit()
        print("[LTX-2.3 LipDub] Models ready.")

    @modal.method()
    def generate(self, payload: dict[str, Any]) -> dict[str, Any]:
        job_id = str(payload.get("job_id") or f"lipdub_{uuid.uuid4().hex[:12]}")
        webhook_url = payload.get("webhook_url")
        prompt = str(
            payload.get("prompt")
            or "A performer sings naturally to the supplied vocal performance, with accurate mouth movement and stable identity."
        ).strip()
        reference_strength = min(1.5, max(0.0, float(payload.get("reference_strength", 1.0))))
        audio_start = max(0.0, float(payload.get("audio_start", 0.0)))
        raw_audio_end = payload.get("audio_end")
        audio_end = float(raw_audio_end) if raw_audio_end is not None else None
        if audio_end is not None and audio_end <= audio_start:
            raise ValueError("audio_end must be greater than audio_start")
        seed = int(payload.get("seed", 42))
        work_dir = Path(f"/tmp/{job_id}-{uuid.uuid4().hex[:8]}")
        work_dir.mkdir(parents=True, exist_ok=True)

        try:
            source_video = _write_media(payload, "video", work_dir)
            replacement_audio = _write_media(payload, "audio", work_dir)
            reference_video = work_dir / "reference-with-new-audio.mp4"
            output_name = f"lipdub-{uuid.uuid4()}.mp4"
            output_path = OUTPUT_DIR / output_name
            audio_trim_args = ["-ss", str(audio_start)]
            if audio_end is not None:
                audio_trim_args.extend(["-t", str(audio_end - audio_start)])

            print(f"[LTX-2.3 LipDub] Preparing reference media for {job_id}")
            _run(
                [
                    "ffmpeg",
                    "-y",
                    "-loglevel",
                    "error",
                    "-i",
                    str(source_video),
                    *audio_trim_args,
                    "-i",
                    str(replacement_audio),
                    "-map",
                    "0:v:0",
                    "-map",
                    "1:a:0",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "fast",
                    "-crf",
                    "18",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-ar",
                    "48000",
                    "-shortest",
                    "-movflags",
                    "+faststart",
                    str(reference_video),
                ],
                timeout=300,
            )

            print(f"[LTX-2.3 LipDub] Running official LipDub pipeline for {job_id}")
            _run(
                [
                    sys.executable,
                    "-m",
                    "ltx_pipelines.lipdub",
                    "--distilled-checkpoint-path",
                    str(self.checkpoint_path),
                    "--spatial-upsampler-path",
                    str(self.upsampler_path),
                    "--gemma-root",
                    str(GEMMA_DIR),
                    "--lora",
                    str(self.lipdub_path),
                    "1.0",
                    "--reference-video",
                    str(reference_video),
                    "--reference-strength",
                    str(reference_strength),
                    "--prompt",
                    prompt,
                    "--height",
                    "512",
                    "--width",
                    "768",
                    "--seed",
                    str(seed),
                    "--quantization",
                    "fp8-cast",
                    "--offload",
                    "cpu",
                    "--output-path",
                    str(output_path),
                ],
                timeout=6600,
            )

            if not output_path.is_file() or output_path.stat().st_size == 0:
                raise RuntimeError("LipDub pipeline completed without creating an MP4")
            output_volume.commit()

            file_base_url = get_file.get_web_url()
            if not file_base_url:
                raise RuntimeError("Modal LipDub file endpoint URL is unavailable")
            video_url = f"{file_base_url}?filename={output_name}"
            result = {"status": "completed", "job_id": job_id, "video_url": video_url}
            _send_webhook(webhook_url, result)
            print(f"[LTX-2.3 LipDub] Completed {job_id}: {video_url}")
            return result
        except Exception as error:  # noqa: BLE001
            message = f"{type(error).__name__}: {error}"
            print(f"[LTX-2.3 LipDub] Failed {job_id}: {message}")
            _send_webhook(
                webhook_url,
                {"status": "failed", "job_id": job_id, "error": message},
            )
            raise
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)


@app.function(image=web_image, volumes={str(OUTPUT_DIR): output_volume})
@modal.fastapi_endpoint(method="GET")
def get_file(filename: str):
    from fastapi.responses import FileResponse, JSONResponse

    safe_name = Path(filename).name
    if safe_name != filename or not safe_name.startswith("lipdub-"):
        return JSONResponse({"error": "Invalid filename"}, status_code=400)

    output_volume.reload()
    path = OUTPUT_DIR / safe_name
    if not path.is_file():
        return JSONResponse({"error": "LipDub clip not found"}, status_code=404)
    return FileResponse(path, media_type="video/mp4", filename=safe_name)


@app.function(image=web_image)
@modal.fastapi_endpoint(method="POST")
def lip_sync(payload: dict[str, Any]):
    from fastapi import HTTPException

    if not (payload.get("video_url") or payload.get("video_base64")):
        raise HTTPException(status_code=400, detail="video_url or video_base64 is required")
    if not (payload.get("audio_url") or payload.get("audio_base64")):
        raise HTTPException(status_code=400, detail="audio_url or audio_base64 is required")

    job_id = str(payload.get("job_id") or f"lipdub_{uuid.uuid4().hex[:12]}")
    payload = {**payload, "job_id": job_id}
    call = LipDubRunner().generate.spawn(payload)
    return {"status": "accepted", "job_id": job_id, "call_id": call.object_id}
