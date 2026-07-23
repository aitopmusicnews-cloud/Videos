from __future__ import annotations

import io
import uuid
from pathlib import Path

import modal

app = modal.App("mvs-ltx-video")

MODEL_DIR = "/models"
OUTPUT_DIR = "/outputs"
MODEL_ID = "diffusers/LTX-2.3-Distilled-Diffusers"

model_volume = modal.Volume.from_name("mvs-ltx-models", create_if_missing=True)
output_volume = modal.Volume.from_name("mvs-ltx-outputs", create_if_missing=True)

web_image = modal.Image.debian_slim(python_version="3.12").uv_pip_install(
    "fastapi[standard]>=0.115.8",
)

model_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "git")
    .uv_pip_install(
        "git+https://github.com/huggingface/diffusers.git",
        "accelerate>=1.4.0",
        "av>=14.0.0",
        "fastapi[standard]>=0.115.8",
        "huggingface-hub>=0.36.0",
        "httpx>=0.27.2",
        "imageio>=2.37.0",
        "imageio-ffmpeg>=0.6.0",
        "numpy>=1.26.0",
        "pillow>=11.1.0",
        "protobuf>=5.29.3",
        "sentencepiece>=0.2.0",
        "torch>=2.7.0",
        "transformers>=4.53.0",
    )
    .env({"HF_HOME": MODEL_DIR, "HF_HUB_CACHE": MODEL_DIR})
)


@app.cls(
    image=model_image,
    gpu="A100-80GB",
    timeout=1800,
    scaledown_window=300,
    volumes={MODEL_DIR: model_volume, OUTPUT_DIR: output_volume},
)
class LTXGenerator:
    @modal.enter()
    def load_model(self) -> None:
        import torch
        from diffusers import LTX2ConditionPipeline

        print(f"[LTX-2.3] Loading {MODEL_ID}...")
        self.pipe = LTX2ConditionPipeline.from_pretrained(
            MODEL_ID,
            torch_dtype=torch.bfloat16,
        ).to("cuda")
        self.pipe.vae.enable_tiling()
        model_volume.commit()
        print("[LTX-2.3] Model ready.")

    @modal.method()
    def generate_clip(
        self,
        prompt: str,
        duration_sec: float = 5.0,
        init_image_url: str | None = None,
        webhook_url: str | None = None,
        job_id: str | None = None,
        file_base_url: str | None = None,
    ) -> dict:
        import httpx
        from PIL import Image
        from diffusers.pipelines.ltx2.pipeline_ltx2_condition import LTX2VideoCondition
        from diffusers.pipelines.ltx2.utils import (
            DEFAULT_NEGATIVE_PROMPT,
            DISTILLED_SIGMA_VALUES,
        )

        try:
            fps = 24.0
            duration_sec = min(5.0, max(1.0, float(duration_sec)))
            requested_frames = round(duration_sec * fps)
            num_frames = ((requested_frames - 1) // 8) * 8 + 1
            num_frames = max(9, min(num_frames, 121))

            conditions = None
            if init_image_url:
                print(f"[LTX-2.3] Loading first-frame condition: {init_image_url}")
                with httpx.Client(timeout=45.0, follow_redirects=True) as client:
                    response = client.get(init_image_url)
                    response.raise_for_status()
                image = Image.open(io.BytesIO(response.content)).convert("RGB")
                conditions = [LTX2VideoCondition(frames=image, index=0, strength=1.0)]

            print(
                f"[LTX-2.3] Generating {num_frames} frames at {fps} fps "
                f"for job {job_id or 'untracked'}"
            )
            video, audio = self.pipe(
                conditions=conditions,
                prompt=prompt,
                negative_prompt=DEFAULT_NEGATIVE_PROMPT,
                width=768,
                height=512,
                num_frames=num_frames,
                frame_rate=fps,
                num_inference_steps=8,
                sigmas=DISTILLED_SIGMA_VALUES,
                guidance_scale=1.0,
                output_type="np",
                return_dict=False,
            )

            filename = f"ltx23-{uuid.uuid4()}.mp4"
            filepath = Path(OUTPUT_DIR) / filename
            self._encode_video_with_audio(
                video_frames=video[0],
                audio_tensor=audio[0],
                fps=fps,
                audio_sample_rate=int(self.pipe.vocoder.config.output_sampling_rate),
                output_path=filepath,
            )
            output_volume.commit()

            if not file_base_url:
                raise RuntimeError("Modal file endpoint URL is unavailable.")
            video_url = f"{file_base_url}?filename={filename}"
            result = {
                "status": "completed",
                "job_id": job_id,
                "video_url": video_url,
            }
            self._send_webhook(webhook_url, result)
            print(f"[LTX-2.3] Completed job {job_id}: {video_url}")
            return result
        except Exception as error:
            message = f"{type(error).__name__}: {error}"
            print(f"[LTX-2.3] Job {job_id} failed: {message}")
            self._send_webhook(
                webhook_url,
                {"status": "failed", "job_id": job_id, "error": message},
            )
            raise

    @staticmethod
    def _encode_video_with_audio(
        video_frames,
        audio_tensor,
        fps: float,
        audio_sample_rate: int,
        output_path: Path,
    ) -> None:
        """Encode LTX frames and audio without Diffusers' unstable encode_video shim."""
        import subprocess
        import wave

        import imageio.v2 as imageio
        import numpy as np

        silent_video_path = output_path.with_suffix(".silent.mp4")
        audio_path = output_path.with_suffix(".wav")

        frames = np.asarray(video_frames)
        if np.issubdtype(frames.dtype, np.floating):
            frames = np.clip(frames, 0.0, 1.0)
            frames = np.rint(frames * 255.0).astype(np.uint8)
        elif frames.dtype != np.uint8:
            frames = np.clip(frames, 0, 255).astype(np.uint8)

        audio = audio_tensor.detach().float().cpu().numpy()
        audio = np.squeeze(audio)
        if audio.ndim == 1:
            audio = audio[np.newaxis, :]
        elif audio.ndim != 2:
            raise ValueError(f"Unexpected audio shape: {audio.shape}")

        # LTX audio is channels-first. WAV PCM expects samples-first.
        audio = np.clip(audio, -1.0, 1.0)
        pcm = np.rint(audio.T * 32767.0).astype(np.int16)

        try:
            imageio.mimsave(
                silent_video_path,
                frames,
                fps=fps,
                codec="libx264",
                quality=8,
                macro_block_size=None,
                ffmpeg_log_level="error",
            )

            with wave.open(str(audio_path), "wb") as wav_file:
                wav_file.setnchannels(int(pcm.shape[1]))
                wav_file.setsampwidth(2)
                wav_file.setframerate(audio_sample_rate)
                wav_file.writeframes(pcm.tobytes())

            completed = subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-loglevel",
                    "error",
                    "-i",
                    str(silent_video_path),
                    "-i",
                    str(audio_path),
                    "-c:v",
                    "copy",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-shortest",
                    "-movflags",
                    "+faststart",
                    str(output_path),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            if completed.returncode != 0:
                raise RuntimeError(f"ffmpeg mux failed: {completed.stderr.strip()}")
            if not output_path.is_file() or output_path.stat().st_size == 0:
                raise RuntimeError("ffmpeg did not create a valid MP4 file")
        finally:
            silent_video_path.unlink(missing_ok=True)
            audio_path.unlink(missing_ok=True)

    @staticmethod
    def _send_webhook(webhook_url: str | None, payload: dict) -> None:
        if not webhook_url:
            return
        import httpx

        try:
            response = httpx.post(webhook_url, json=payload, timeout=20.0)
            response.raise_for_status()
        except Exception as callback_error:
            print(f"[Webhook] Callback failed: {callback_error}")


@app.function(image=web_image, volumes={OUTPUT_DIR: output_volume})
@modal.fastapi_endpoint(method="GET")
def get_file(filename: str):
    from fastapi.responses import FileResponse, JSONResponse

    safe_name = Path(filename).name
    if safe_name != filename or not safe_name.startswith("ltx23-"):
        return JSONResponse({"error": "Invalid filename"}, status_code=400)

    output_volume.reload()
    filepath = Path(OUTPUT_DIR) / safe_name
    if not filepath.is_file():
        return JSONResponse({"error": "Clip not found"}, status_code=404)
    return FileResponse(filepath, media_type="video/mp4", filename=safe_name)


@app.function(image=web_image)
@modal.fastapi_endpoint(method="POST")
def generate(payload: dict):
    from fastapi import HTTPException

    prompt = str(payload.get("prompt", "")).strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")

    try:
        duration = min(5.0, max(1.0, float(payload.get("duration", 5.0))))
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=400, detail="duration must be a number") from error

    job_id = str(payload.get("job_id") or f"modal_{uuid.uuid4().hex[:12]}")
    webhook_url = payload.get("webhook_url")
    init_image_url = payload.get("init_image_url")
    file_base_url = get_file.get_web_url()
    if not file_base_url:
        raise HTTPException(status_code=503, detail="file endpoint URL is unavailable")

    call = LTXGenerator().generate_clip.spawn(
        prompt=prompt,
        duration_sec=duration,
        init_image_url=init_image_url,
        webhook_url=webhook_url,
        job_id=job_id,
        file_base_url=file_base_url,
    )
    return {
        "status": "accepted",
        "job_id": job_id,
        "call_id": call.object_id,
    }
