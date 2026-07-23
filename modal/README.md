# 🌌 Modal Cloud Pipeline Setup

This directory houses the custom Python microservices deployed to **Modal** that power the core audio analysis and generative workflows for Music Video Studio (MVS). By migrating entirely to Modal, the application operates with maximum compute efficiency and removes any external dependencies on third-party APIs like Fal.ai or OpenRouter.

---

## 🛠️ Infrastructure Overview

The pipeline consists of three independent Modal microservices:

| Microservice | Script Name | GPU Requirements | Volumes Managed | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Audio Analyzer** | `audio_analysis.py` | CPU (or light T4) | *None* | Performs beat tracking, BPM detection, onset mapping, RMS amplitude curves, and musical key estimation. |
| **LTX Video v2.3** | `ltx_video.py` | **A100-80GB** | `mvs-ltx-models` <br> `mvs-ltx-outputs` | Renders high-fidelity, joint audio-video 24fps motion clips driven by custom text prompts and optional reference images. Supports asynchronous webhook callbacks. |
| **Media Suite** | `media_suite.py` | **A10G** | `mvs-suite-outputs` | Generates high-fashion visual style presets (SDXL) and handles Lip-Sync synchronization tasks. |

---

## 🚀 Step-by-Step Deployment Guide

### 1. Prerequisite Setup

Before deploying, ensure you have the Modal CLI installed locally and authenticated with your Modal account.

```bash
# 1. Navigate to the modal directory
cd modal

# 2. Create and activate a clean virtual environment
python -m venv .venv
source .venv/bin/activate

# 3. Install required setup packages
pip install modal fastapi httpx

# 4. Authenticate with your Modal account
modal token new
```

---

### 2. Deploying the Microservices

Deploy each worker into your Modal namespace using the commands below:

#### 🎧 Deploy the Audio Analyzer
```bash
modal deploy audio_analysis.py
```
* **Output Endpoint:** `https://<your-workspace>--mvs-audio-analyze.modal.run`
* **Verification:** Exposes a `POST /` endpoint accepting a remote audio URL for sub-second structure extraction.

#### 🎥 Deploy LTX-Video v2.3 (Joint Audio-Video Generator)
```bash
modal deploy ltx_video.py
```
* **Output Endpoint:** `https://<your-workspace>--mvs-ltx-video-generate.modal.run`
* **File Resolver:** `https://<your-workspace>--mvs-ltx-video-get-file.modal.run`
* **Details:** On first deployment, Modal will automatically provision the `mvs-ltx-models` and `mvs-ltx-outputs` volumes, then download the `diffusers/LTX-2.3-Diffusers` foundation weights directly to the cloud volume.

#### 🎨 Deploy the Media Suite (SDXL & LipSync)
```bash
modal deploy media_suite.py
```
* **Output Endpoint (Text-To-Image):** `https://<your-workspace>--mvs-media-suite-text-to-image.modal.run`
* **Output Endpoint (LipSync):** `https://<your-workspace>--mvs-media-suite-lip-sync.modal.run`
* **File Resolver:** `https://<your-workspace>--mvs-media-suite-get-file.modal.run`

---

## ⚙️ Environment Configuration

Once all three services are deployed, update your `.env` file in the project's root folder with your live Modal endpoints:

```env
# --- AUDIO ANALYSIS SERVICE ---
MODAL_AUDIO_URL=https://<your-workspace>--mvs-audio-analyze.modal.run

# --- LTX-VIDEO GENERATOR SERVICE ---
MODAL_LTX_URL=https://<your-workspace>--mvs-ltx-video-generate.modal.run

# --- LOCAL INFERENCE BACKUP (Optional) ---
LOCAL_INFERENCE_URL=http://localhost:3002
```

---

## 🧪 Testing the Pipeline

### Testing Audio Analysis
You can send a curl request directly to your newly deployed analyzer endpoint to test its feature extraction engine:

```bash
curl -X POST $MODAL_AUDIO_URL \
  -H "Content-Type: application/json" \
  -d '{"url": "https://pub-c5e31b5cdafb419a866171f8ef419515.r2.dev/audio_sample.mp3"}' | jq .
```

**Expected JSON Response Shape:**
```json
{
  "duration": 180.4,
  "bpm": 124.0,
  "key": "G# Minor",
  "beats": [0.48, 0.97, 1.45, 1.94, 2.42],
  "downbeats": [0.48, 2.42, 4.36],
  "onsets": [0.12, 0.48, 0.82, 0.97],
  "rms_curve": [0.01, 0.05, 0.12, 0.22],
  "sections": [
    {"start": 0.0, "end": 30.2, "label": "section 1"},
    {"start": 30.2, "end": 90.5, "label": "section 2"}
  ]
}
```

### Testing LTX-Video v2.3 Generation
The LTX-Video worker accepts prompts and schedules asynchronous GPU execution. You can test it by running:

```bash
curl -X POST $MODAL_LTX_URL \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Cinematic shot of neon cybercity streets at night, high contrast obsidian reflections", "duration": 4.0}'
```

---

## 🛠️ Local Development & Debugging

If you prefer to debug the audio processing core locally without committing Modal compute units:

```bash
# Start local FastAPI web service on port 3002
python local_server.py
```
Then set your environment file to use the local server:
```env
MODAL_AUDIO_URL=http://localhost:3002
```
