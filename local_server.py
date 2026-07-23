# -*- coding: utf-8 -*-
"""
Local Inference API Server for Music Video Studio
Runs a free local FastAPI server to handle video and image generation.
Supports Wan 2.1, HunyuanVideo, Stable Diffusion, or high-quality procedural fallbacks.
"""

import os
import sys
import uuid
import time
from typing import Optional
from fastapi import FastAPI, Request, Query, HTTPException
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Try importing ML libraries. If missing, we'll gracefully fall back to procedural mode.
HAS_TORCH = False
HAS_DIFFUSERS = False

try:
    import torch
    HAS_TORCH = True
except ImportError:
    print("[Warning] 'torch' is not installed or fully loaded. Local GPU acceleration will be unavailable.")

try:
    import diffusers
    from diffusers import DiffusionPipeline
    HAS_DIFFUSERS = True
except ImportError:
    print("[Warning] 'diffusers' is not installed. Real model pipelines cannot be loaded directly, falling back to procedural simulator.")

# We will also try PIL to generate images/videos procedurally if models aren't loaded yet.
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("[Error] 'Pillow' is required. Please run: pip install Pillow")
    sys.exit(1)

# Ensure output directories exist
OUTPUT_DIR = os.path.join(os.getcwd(), "local_storage")
os.makedirs(OUTPUT_DIR, exist_ok=True)

app = FastAPI(
    title="Music Video Studio - Free Local Inference Server",
    description="Local open-source server for Wan 2.1 / HunyuanVideo / SD models or procedural simulation.",
    version="1.0.0"
)

# Enable CORS for cross-origin local requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files to serve generated assets
app.mount("/static", StaticFiles(directory=OUTPUT_DIR), name="static")

# Request validation schemas
class VideoGenerationRequest(BaseModel):
    prompt: str
    image_url: Optional[str] = None
    ratio: Optional[str] = "16:9"
    model: Optional[str] = "wan2.1"

class ImageGenerationRequest(BaseModel):
    prompt: str
    model: Optional[str] = "wan2.1"

# --- MODEL MANAGERS (Lazy Loaded on first request to prevent slow server startup) ---
class LocalModelManager:
    def __init__(self):
        self.video_pipeline = None
        self.image_pipeline = None
        self.is_loading_video = False
        self.is_loading_image = False

    def load_video_pipeline(self):
        if self.video_pipeline is not None:
            return self.video_pipeline
        
        if not HAS_TORCH or not HAS_DIFFUSERS:
            raise RuntimeError("Torch or Diffusers is not installed. Cannot load real model pipeline.")
        
        print("[Model Engine] Initializing Wan 2.1 Video Pipeline (Wan-AI/Wan2.1-T2V-1.3B)...")
        self.is_loading_video = True
        try:
            # We default to the 1.3B model as it fits easily on consumer GPUs (under 8GB VRAM with quantization/offloading)
            from diffusers import WanPipeline
            
            device = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
            dtype = torch.bfloat16 if device != "cpu" else torch.float32
            
            print(f"[Model Engine] Loading model onto device: {device} with dtype: {dtype}")
            pipeline = WanPipeline.from_pretrained(
                "Wan-AI/Wan2.1-T2V-1.3B", 
                torch_dtype=dtype
            )
            
            # Enable memory optimizations if using CUDA
            if device == "cuda":
                pipeline.enable_model_cpu_offload()
            else:
                pipeline.to(device)
                
            self.video_pipeline = pipeline
            print("[Model Engine] Wan 2.1 Video Pipeline loaded successfully!")
            return self.video_pipeline
        except Exception as e:
            print(f"[Model Engine Error] Failed to load video model: {e}")
            raise e
        finally:
            self.is_loading_video = False

    def load_image_pipeline(self):
        if self.image_pipeline is not None:
            return self.image_pipeline
            
        if not HAS_TORCH or not HAS_DIFFUSERS:
            raise RuntimeError("Torch or Diffusers is not installed. Cannot load real model pipeline.")
            
        print("[Model Engine] Initializing Stable Diffusion Pipeline (stabilityai/stable-diffusion-2-1-base)...")
        self.is_loading_image = True
        try:
            device = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
            dtype = torch.float16 if device == "cuda" else torch.float32
            
            pipeline = DiffusionPipeline.from_pretrained(
                "stabilityai/stable-diffusion-2-1-base",
                torch_dtype=dtype
            )
            pipeline.to(device)
            self.image_pipeline = pipeline
            print("[Model Engine] Stable Diffusion pipeline loaded successfully!")
            return self.image_pipeline
        except Exception as e:
            print(f"[Model Engine Error] Failed to load image model: {e}")
            raise e
        finally:
            self.is_loading_image = False

manager = LocalModelManager()

# --- HIGH QUALITY PROCEDURAL GENERATORS (Ultra-fast, zero-dependancy beautiful fallbacks) ---
def generate_procedural_image(prompt: str, filename: str) -> str:
    """Generates an aesthetic grid-patterned visual matching the prompt words."""
    width, height = 1024, 576  # 16:9 Aspect Ratio
    img = Image.new("RGB", (width, height), "#0a0a0f")
    draw = ImageDraw.Draw(img)
    
    # Elegant procedural design based on prompt hash
    p_hash = hash(prompt)
    hue_primary = p_hash % 360
    hue_secondary = (p_hash + 120) % 360
    
    # Draw background cosmic gradients/circles
    for i in range(15):
        radius = (p_hash + i * 40) % 400 + 100
        cx = (p_hash * (i + 1)) % width
        cy = (p_hash + i * 50) % height
        # Draw soft glowing circles
        color = f"hsl({hue_primary}, 70%, {10 + i * 2}%)"
        draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], outline=color, width=2)

    # Draw neon tech lines
    for i in range(8):
        x = (p_hash + i * 150) % width
        draw.line([(x, 0), (x, height)], fill=f"hsl({hue_secondary}, 50%, 15%)", width=1)
        y = (p_hash * i * 3) % height
        draw.line([(0, y), (width, y)], fill=f"hsl({hue_secondary}, 50%, 15%)", width=1)

    # Draw elegant card background in center
    card_w, card_h = 700, 200
    cx1, cy1 = (width - card_w) // 2, (height - card_h) // 2
    cx2, cy2 = cx1 + card_w, cy1 + card_h
    draw.rounded_rectangle([cx1, cy1, cx2, cy2], radius=16, fill="#12121e", outline="#ffffff", width=1)
    
    # Overlay Prompt Text
    clean_prompt = prompt if len(prompt) < 65 else prompt[:62] + "..."
    draw.text((cx1 + 40, cy1 + 50), "LOCAL GENERATOR ACTIVE", fill="#00ffcc")
    draw.text((cx1 + 40, cy1 + 90), f'Prompt: "{clean_prompt}"', fill="#e5e7eb")
    draw.text((cx1 + 40, cy1 + 130), f"Status: Simulated High-Fidelity Render", fill="#9ca3af")
    
    file_path = os.path.join(OUTPUT_DIR, filename)
    img.save(file_path, "PNG")
    return file_path

def generate_procedural_video(prompt: str, filename: str) -> str:
    """Generates an elegant multi-frame simulated sequence to simulate video generation."""
    # Since writing a real compressed MP4 from scratch inside pure python without cv2/ffmpeg can be tricky,
    # we'll write a series of beautiful PIL frames, and compile them if ffmpeg is on system, 
    # or save a high-quality looping animated GIF/WebP labeled as video.
    # To be extremely compatible, we can use standard python-based rendering.
    file_path = os.path.join(OUTPUT_DIR, filename)
    width, height = 854, 480
    frames = []
    
    p_hash = hash(prompt)
    hue = p_hash % 360
    
    # Generate 15 fluid motion frames
    for f in range(24):
        img = Image.new("RGB", (width, height), "#050508")
        draw = ImageDraw.Draw(img)
        
        # Draw moving stars / lines
        for i in range(30):
            star_x = (p_hash + i * 200 + f * 4) % width
            star_y = (p_hash * i + f * 2) % height
            radius = (i % 3) + 1
            draw.ellipse([star_x - radius, star_y - radius, star_x + radius, star_y + radius], fill="#ffffff")
            
        # Draw sweeping beam
        beam_x = (f * (width // 24)) % width
        draw.line([(beam_x, 0), (width - beam_x, height)], fill=f"hsl({hue}, 80%, 30%)", width=3)
        
        # Center Info
        draw.rounded_rectangle([150, 150, width - 150, height - 150], radius=12, fill="#0f0f15", outline="#00ffcc", width=1)
        draw.text((200, 190), "LOCAL VIDEO PREVIEW", fill="#00ffcc")
        draw.text((200, 230), f"Frame {f+1}/24 - Simulating motion loop...", fill="#e5e7eb")
        draw.text((200, 270), f"Prompt: {prompt[:40]}...", fill="#9ca3af")
        
        frames.append(img)
        
    # Save as high-quality WebP or animated GIF that browsers can play as a video source directly!
    # Browsers can handle WebP/GIF in video tags perfectly or as image tags.
    # To ensure maximum compatibility, we save as WebP with infinite loop.
    frames[0].save(
        file_path,
        save_all=True,
        append_images=frames[1:],
        duration=80, # ~12.5 FPS
        loop=0
    )
    return file_path


# --- ENDPOINTS ---

@app.post("/v1/image/generate")
async def generate_image(req: Optional[ImageGenerationRequest] = None, prompt: Optional[str] = Query(None)):
    # Extract prompt from query or JSON body
    target_prompt = ""
    if req and req.prompt:
        target_prompt = req.prompt
    elif prompt:
        target_prompt = prompt
        
    if not target_prompt:
        raise HTTPException(status_code=400, detail="Missing parameter: 'prompt'")
        
    print(f"[API] Received image generation request: {target_prompt}")
    filename = f"image_{uuid.uuid4().hex}.png"
    
    # Try using real pipeline if available
    if HAS_TORCH and HAS_DIFFUSERS:
        try:
            pipeline = manager.load_image_pipeline()
            result = pipeline(target_prompt, num_inference_steps=20).images[0]
            file_path = os.path.join(OUTPUT_DIR, filename)
            result.save(file_path)
            print(f"[API] Image generated successfully using Stable Diffusion!")
            return {"image_url": f"/static/{filename}"}
        except Exception as e:
            print(f"[API Warning] Stable Diffusion pipeline failed, falling back to procedural: {e}")
            
    # Procedural fallbacks
    generate_procedural_image(target_prompt, filename)
    print(f"[API] Generated procedural image fallback: {filename}")
    return {"image_url": f"/static/{filename}"}


@app.post("/v1/video/generate")
async def generate_video(req: Optional[VideoGenerationRequest] = None, prompt: Optional[str] = Query(None)):
    target_prompt = ""
    if req and req.prompt:
        target_prompt = req.prompt
    elif prompt:
        target_prompt = prompt
        
    if not target_prompt:
        raise HTTPException(status_code=400, detail="Missing parameter: 'prompt'")
        
    print(f"[API] Received video generation request: {target_prompt}")
    # Using .webp as container for maximum reliability in direct python compilation
    filename = f"video_{uuid.uuid4().hex}.webp"
    
    # Try using real Wan 2.1 pipeline if available
    if HAS_TORCH and HAS_DIFFUSERS:
        try:
            pipeline = manager.load_video_pipeline()
            # Run model generation (example: 24-48 frames for lightweight local testing)
            video_frames = pipeline(target_prompt, num_frames=31, dimensions=(720, 480)).frames
            # Compile frames to gif/webp
            file_path = os.path.join(OUTPUT_DIR, filename)
            video_frames[0].save(
                file_path,
                save_all=True,
                append_images=video_frames[1:],
                duration=100,
                loop=0
            )
            print(f"[API] Video generated successfully using Wan 2.1 pipeline!")
            return {"video_url": f"/static/{filename}"}
        except Exception as e:
            print(f"[API Warning] Wan 2.1 pipeline failed, falling back to procedural: {e}")

    # Procedural fallbacks
    generate_procedural_video(target_prompt, filename)
    print(f"[API] Generated procedural video fallback: {filename}")
    return {"video_url": f"/static/{filename}"}


# --- DASHBOARD HOME PAGE ---
@app.get("/", response_class=HTMLResponse)
async def home_page(request: Request):
    host_url = str(request.base_url).rstrip("/")
    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Music Video Studio - Inference Engine</title>
        <style>
            body {{
                background: #09090e;
                color: #e2e8f0;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                margin: 0;
                padding: 40px 20px;
                display: flex;
                flex-direction: column;
                align-items: center;
            }}
            .card {{
                background: #11111a;
                border: 1px solid #1f1f2e;
                border-radius: 12px;
                padding: 30px;
                max-width: 650px;
                width: 100%;
                box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            }}
            h1 {{
                font-size: 24px;
                margin-top: 0;
                color: #00ffcc;
                border-bottom: 2px solid #1f1f2e;
                padding-bottom: 10px;
            }}
            p {{
                line-height: 1.6;
                color: #94a3b8;
            }}
            .status-badge {{
                display: inline-block;
                padding: 6px 12px;
                border-radius: 9999px;
                font-size: 13px;
                font-weight: bold;
                background: #10b981;
                color: #042f1a;
                margin-bottom: 15px;
            }}
            .code-block {{
                background: #07070a;
                padding: 15px;
                border-radius: 6px;
                font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
                font-size: 14px;
                color: #38bdf8;
                border: 1px solid #0f172a;
                overflow-x: auto;
            }}
            .footer {{
                margin-top: 30px;
                font-size: 12px;
                color: #475569;
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <div class="status-badge">● ONLINE & ACTIVE</div>
            <h1>Music Video Studio - Inference API</h1>
            <p>Your local background inference server is up and running perfectly! This handles offline generation completely for free with zero token fees.</p>
            
            <h3>Connection Guide</h3>
            <p>To hook this up with your Music Video Studio workspace, copy the following URL and paste it in your workspace <code>.env</code> file under <code>LOCAL_INFERENCE_URL</code>:</p>
            <div class="code-block">LOCAL_INFERENCE_URL={host_url}</div>
            
            <h3>Endpoints Available</h3>
            <ul>
                <li><code>POST /v1/video/generate</code> - Prompt to video generation</li>
                <li><code>POST /v1/image/generate</code> - Prompt to image generation</li>
            </ul>
        </div>
        <div class="footer">
            Music Video Studio Local Engine v1.0.0 • Powered by FastAPI & Diffusers
        </div>
    </body>
    </html>
    """
    return html_content

if __name__ == "__main__":
    import uvicorn
    import socket

    def is_port_in_use(p: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("0.0.0.0", p))
                return False
            except socket.error:
                return True

    port = 8000
    while is_port_in_use(port):
        print(f"[Server Init] Port {port} is already in use. Trying port {port + 1}...")
        port += 1
        if port > 8020:
            print("[Server Init] Checked ports 8000 to 8020, all in use. Forcing startup on port 8000.")
            port = 8000
            break

    print(f"[Server Init] Starting server on http://localhost:{port}")
    print("\n" + "="*80)
    print("  CLOUDRUN / GOOGLE AI STUDIO DEVELOPMENT NOTICE:")
    print("  Since your Music Video Studio app is hosted in Google's cloud container,")
    print("  the cloud backend CANNOT connect to your physical computer's 'localhost' or '0.0.0.0' directly.")
    print(f"  To allow your cloud app to securely connect to this local inference server,")
    print(f"  you must expose your local port {port} to the public internet using a secure tunnel:")
    print("\n  👉 OPTION A: Using Localtunnel (Easiest - No Signups, No Downloads if you have Node/npm)")
    print(f"     npx localtunnel --port {port}")
    print("\n  👉 OPTION B: Using SSH (No Downloads or Installation Required)")
    print(f"     ssh -R 80:localhost:{port} nokey@localhost.run")
    print("\n  👉 OPTION C: Using Ngrok (Requires updating your ngrok client or creating a free account)")
    print("     ngrok update")
    print(f"     ngrok http {port}")
    print("\n  After running any of the above, copy the resulting public HTTPS URL")
    print("  and paste it in your workspace .env file:")
    print("     LOCAL_INFERENCE_URL=https://xxxx.example.com")
    print("="*80 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=port)
