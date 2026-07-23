from pathlib import Path

import modal

app = modal.App("mvs-media-suite")

OUTPUT_DIR = "/outputs"
output_volume = modal.Volume.from_name("mvs-suite-outputs", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(
        "diffusers==0.32.2",
        "transformers==4.49.0",
        "torch==2.6.0",
        "accelerate==1.4.0",
        "fastapi[standard]==0.115.8",
        "pillow==11.1.0",
    )
)


@app.cls(image=image, gpu="A10G", timeout=300, volumes={OUTPUT_DIR: output_volume})
class ImageGenerator:
    @modal.enter()
    def load_pipeline(self) -> None:
        import torch
        from diffusers import DiffusionPipeline

        self.pipe = DiffusionPipeline.from_pretrained(
            "stabilityai/stable-diffusion-xl-base-1.0",
            torch_dtype=torch.float16,
            use_safetensors=True,
        ).to("cuda")

    @modal.method()
    def generate(self, prompt: str) -> str:
        import uuid

        image_out = self.pipe(prompt=prompt, num_inference_steps=25).images[0]
        filename = f"img-{uuid.uuid4()}.png"
        image_out.save(Path(OUTPUT_DIR) / filename)
        output_volume.commit()
        return filename


@app.function(image=image, volumes={OUTPUT_DIR: output_volume})
@modal.fastapi_endpoint(method="GET")
def get_file(filename: str):
    from fastapi.responses import FileResponse, JSONResponse

    safe_name = Path(filename).name
    if safe_name != filename:
        return JSONResponse({"error": "Invalid filename"}, status_code=400)

    output_volume.reload()
    filepath = Path(OUTPUT_DIR) / safe_name
    if not filepath.is_file():
        return JSONResponse({"error": "Asset not found"}, status_code=404)

    media_type = "image/png" if safe_name.endswith(".png") else "video/mp4"
    return FileResponse(filepath, media_type=media_type, filename=safe_name)


@app.function(image=image, volumes={OUTPUT_DIR: output_volume})
@modal.fastapi_endpoint(method="POST")
def text_to_image(payload: dict):
    from fastapi import HTTPException

    prompt = str(payload.get("prompt", "")).strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is required")

    filename = ImageGenerator().generate.remote(prompt)
    file_base_url = get_file.get_web_url()
    if not file_base_url:
        raise HTTPException(status_code=503, detail="file endpoint URL is unavailable")
    return {"image_url": f"{file_base_url}?filename={filename}"}


@app.function(image=image, volumes={OUTPUT_DIR: output_volume})
@modal.fastapi_endpoint(method="POST")
def lip_sync(payload: dict):
    from fastapi import HTTPException

    raise HTTPException(
        status_code=501,
        detail="Lip sync is not implemented in this open-source deployment.",
    )
