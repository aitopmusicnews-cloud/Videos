import io
import os
from pathlib import Path
import modal

app = modal.App("mvs-media-suite")

# Shared Persistent Volume for output assets
output_volume = modal.Volume.from_name("mvs-suite-outputs", create_if_missing=True)
OUTPUT_DIR = "/outputs"

# Define a unified image with basic media packages, PyTorch, and Diffusers
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(
        "diffusers==0.32.2",
        "transformers==4.49.0",
        "torch==2.6.0",
        "accelerate==1.4.0",
        "fastapi[standard]==0.115.8",
        "pillow==11.1.0"
    )
)

# ----------------------------------------------------------------------
# 1. TEXT TO IMAGE WORKER (SDXL / Flux)
# ----------------------------------------------------------------------
@app.cls(image=image, gpu="A10G", timeout=300, volumes={OUTPUT_DIR: output_volume})
class ImageGenerator:
    @modal.enter()
    def load_pipeline(self):
        import torch
        from diffusers import DiffusionPipeline
        self.pipe = DiffusionPipeline.from_pretrained(
            "stabilityai/stable-diffusion-xl-base-1.0", 
            torch_dtype=torch.float16, 
            use_safetensors=True
        ).to("cuda")

    @modal.method()
    def generate(self, prompt: str) -> str:
        import uuid
        image_out = self.pipe(prompt=prompt, num_inference_steps=25).images[0]
        
        filename = f"img-{uuid.uuid4()}.png"
        filepath = Path(OUTPUT_DIR) / filename
        image_out.save(filepath)
        
        output_volume.commit()
        return filename

# ----------------------------------------------------------------------
# 2. LIP SYNC WORKER (Wav2Lip placeholder container)
# ----------------------------------------------------------------------
@app.function(image=image, gpu="A10G", volumes={OUTPUT_DIR: output_volume})
def process_lipsync(image_url: str, audio_url: str) -> str:
    import uuid
    # Here Wav2Lip processes the audio and lip-syncs it onto the image
    print(f"Syncing audio: {audio_url} onto visual: {image_url}")
    
    # Outputs a completed, lip-synced .mp4 filename
    filename = f"sync-{uuid.uuid4()}.mp4"
    return filename

# ----------------------------------------------------------------------
# FASTAPI ENDPOINTS FOR ALL INCOMING ROUTED JOBS
# ----------------------------------------------------------------------
@app.function(image=image, volumes={OUTPUT_DIR: output_volume})
@modal.fastapi_endpoint(method="POST")
def text_to_image(payload: dict):
    prompt = payload.get("prompt", "")
    gen = ImageGenerator()
    filename = gen.generate.remote(prompt)
    return {"image_url": f"https://cdtfullsail--mvs-media-suite-get-file.modal.run?filename={filename}"}

@app.function(image=image, volumes={OUTPUT_DIR: output_volume})
@modal.fastapi_endpoint(method="POST")
def lip_sync(payload: dict):
    image_url = payload.get("image_url", "")
    audio_url = payload.get("audio_url", "")
    filename = process_lipsync.remote(image_url, audio_url)
    return {"video_url": f"https://cdtfullsail--mvs-media-suite-get-file.modal.run?filename={filename}"}

@app.function(image=image, volumes={OUTPUT_DIR: output_volume})
@modal.fastapi_endpoint(method="GET")
def get_file(filename: str):
    from fastapi.responses import FileResponse
    output_volume.reload()
    filepath = Path(OUTPUT_DIR) / filename
    if filepath.exists():
        media_type = "image/png" if filename.endswith(".png") else "video/mp4"
        return FileResponse(filepath, media_type=media_type)
    return {"error": "Asset not found"}, 404