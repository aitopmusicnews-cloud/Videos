import io
import os
import uuid
from pathlib import Path
import modal

app = modal.App("mvs-ltx-video")

MODEL_DIR = "/models"
OUTPUT_DIR = "/outputs"
model_volume = modal.Volume.from_name("mvs-ltx-models", create_if_missing=True)
output_volume = modal.Volume.from_name("mvs-ltx-outputs", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("python3-opencv", "ffmpeg", "git")
    .uv_pip_install(
        "git+https://github.com/huggingface/diffusers.git",
        "av",
        "accelerate>=1.4.0",
        "fastapi[standard]>=0.115.8",
        "huggingface-hub>=0.36.0",
        "imageio>=2.37.0",
        "imageio-ffmpeg>=0.6.0",
        "opencv-python>=4.11.0.86",
        "pillow>=11.1.0",
        "torch>=2.6.0",
        "transformers>=4.49.0",
        "sentencepiece>=0.2.0",
        "protobuf>=5.29.3",
        "httpx>=0.27.2",
    )
    .env({"HF_HUB_CACHE": MODEL_DIR})
)

@app.cls(
    image=image,
    gpu="A100-80GB",
    timeout=600,
    volumes={MODEL_DIR: model_volume, OUTPUT_DIR: output_volume},
)
class LTXGenerator:
    @modal.enter()
    def load_model(self):
        import torch  # type: ignore
        from diffusers import LTX2Pipeline  # type: ignore
        print("[LTX-2] Loading joint audio-video foundation weights...")
        self.pipe = LTX2Pipeline.from_pretrained(
            "diffusers/LTX-2.3-Diffusers",
            torch_dtype=torch.bfloat16,
        ).to("cuda")

    @modal.method()
    def generate_clip(self, prompt: str, duration_sec: float, init_image_url: str = None) -> str:
        import torch  # type: ignore
        import httpx  # type: ignore
        from PIL import Image  # type: ignore
        from diffusers import LTX2Pipeline  # type: ignore
        from diffusers.utils import encode_video  # type: ignore
        from diffusers.pipelines.ltx2.utils import DEFAULT_NEGATIVE_PROMPT  # type: ignore

        fps = 24.0
        num_frames = int(duration_sec * fps)
        num_frames = ((num_frames - 1) // 8) * 8 + 1
        num_frames = max(9, min(num_frames, 121))

        pipeline_kwargs = {
            "prompt": prompt,
            "negative_prompt": DEFAULT_NEGATIVE_PROMPT,
            "width": 768,
            "height": 512,
            "num_frames": num_frames,
            "frame_rate": fps,
            "num_inference_steps": 30,
            "guidance_scale": 3.0,
            "output_type": "np",
            "return_dict": False,
        }

        if init_image_url:
            print(f"[LTX-2] Processing initial reference frame condition: {init_image_url}")
            try:
                with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                    response = client.get(init_image_url)
                    response.raise_for_status()
                    init_image = Image.open(io.BytesIO(response.content)).convert("RGB")
                    init_image = init_image.resize((768, 512), Image.Resampling.LANCZOS)
                    pipeline_kwargs["image"] = init_image
            except Exception as e:
                print(f"[LTX-2 Warning] Failed to process image conditioning: {str(e)}")

        print(f"[LTX-2] Spawning joint audio-video generation pass for: '{prompt}'")
        video_tensors, audio_tensors = self.pipe(**pipeline_kwargs)

        filename = f"ltx2-{uuid.uuid4()}.mp4"
        filepath = Path(OUTPUT_DIR) / filename

        encode_video(
            video_tensors[0],
            fps=fps,
            audio=audio_tensors[0].float().cpu(),
            audio_sample_rate=self.pipe.vocoder.config.output_sampling_rate,
            output_path=str(filepath),
        )

        print(f"[LTX-2] Rendered output saved to: {filename}")
        output_volume.commit()
        return filename

# The API Endpoint updated for Webhooks
@app.function(image=image, volumes={OUTPUT_DIR: output_volume})
@modal.fastapi_endpoint(method="POST")
def generate(payload: dict):
    import httpx  # type: ignore
    prompt = payload.get("prompt", "")
    duration = float(payload.get("duration", 4.0))
    init_image_url = payload.get("init_image_url", None)
    webhook_url = payload.get("webhook_url", None)
    job_id = payload.get("job_id", None)

    gen = LTXGenerator()

    try:
        # Run the computation
        filename = gen.generate_clip.remote(prompt, duration, init_image_url)
        video_url = f"https://cdtfullsail--mvs-ltx-video-get-file.modal.run?filename={filename}"

        # Trigger the webhook callback back to Node.js if provided
        if webhook_url:
            print(f"[Webhook] Dispatching success callback to: {webhook_url}")
            httpx.post(webhook_url, json={
                "status": "completed",
                "job_id": job_id,
                "video_url": video_url
            }, timeout=10.0)

        return {"status": "processing_triggered", "video_url": video_url}

    except Exception as e:
        print(f"[Modal Error] Generation failed: {str(e)}")
        if webhook_url:
            import httpx  # type: ignore
            try:
                httpx.post(webhook_url, json={
                    "status": "failed",
                    "job_id": job_id,
                    "error": str(e)
                }, timeout=10.0)
            except Exception as cb_err:
                print(f"[Webhook Error] Failed to dispatch failure callback: {str(cb_err)}")
        raise e

@app.function(image=image, volumes={OUTPUT_DIR: output_volume})
@modal.fastapi_endpoint(method="GET")
def get_file(filename: str):
    from fastapi.responses import FileResponse  # type: ignore
    output_volume.reload()
    filepath = Path(OUTPUT_DIR) / filename
    if filepath.exists():
        return FileResponse(filepath, media_type="video/mp4")
    return {"error": "Clip not found"}, 404