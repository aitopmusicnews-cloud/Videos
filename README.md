# 🎬 Keep Em' Thirsty — AI Music Video Studio (MVS)

A full-stack AI Music Video Studio application engineered for creating high-performance, beat-synchronized music videos driven by AI video generation and audio-reactive timeline choreography. Designed for the gritty, neo-noir rap track *"Keep Em' Thirsty"*, MVS empowers creators, visual directors, and audio editors to construct frame-accurate video sequences locked seamlessly onto audio beats, integrate custom avatars, and render finished high-fidelity videos.

---

## 📋 Table of Contents
1. [Project Overview & Purpose](#-project-overview--purpose)
2. [Key Features](#-key-features)
3. [Architecture & Workspace Structure](#-architecture--workspace-structure)
4. [Installation & Local Setup](#-installation--local-setup)
5. [Configuration & Environment Variables](#-configuration--environment-variables)
6. [Modal Pipeline & GPU Microservices](#-modal-pipeline--gpu-microservices)
7. [Step-by-Step User Guide](#-step-by-step-user-guide)
8. [Testing & Quality Assurance](#-testing--quality-assurance)
9. [Troubleshooting & Frequently Asked Questions](#-troubleshooting--frequently-asked-questions)
10. [Production Deployment Guide](#-production-deployment-guide)

---

## 🎯 Project Overview & Purpose

Music Video Studio (MVS) bridges the gap between high-level audio production and state-of-the-art generative video models. Instead of manually editing video clips to match a track's rhythm, MVS automatically analyzes audio waveform dynamics (BPM, beat ticks, downbeats, onset peaks, and energy levels) and exposes a precision interactive timeline where every visual clip seamlessly interlocks with the beat grid.

### Core Capabilities:
* **Audio-Reactive Timeline**: Interactive WaveSurfer waveform display with beat grids, transient markers, and live playhead seeking.
* **LTX-Video v2.3 Integration**: Generates joint audio-video 24fps clips powered by custom Modal GPU serverless pipelines.
* **Avatar & LipSync Suite**: Upload lookbook models, generate avatars, and perform lip-syncing tied to vocal stems.
* **Storage Flexibility**: Native support for AWS S3 / CloudFront streaming and local filesystem fallback.
* **Zero Missing Assets**: Intelligent fallback overlays and asset-recovery prompts if temporary media files expire.

---

## ✨ Key Features

### 🎧 Audio & Beat Grid Engine
* **Automatic Audio Analysis**: Instant extraction of track tempo (BPM), musical key, beat ticks, downbeats, and vocal stems.
* **Interactive Waveform**: High-performance WaveSurfer.js integration with dynamic zoom (`+` / `-` / `Fit`), timeline scrubbing, and loop playback.
* **Expired Asset Detection**: Smart inline alerts and quick re-upload triggers if an audio stream yields a 404 error.

### 🎥 Multi-Track Timeline Editor
* **Non-Destructive Clip Management**: Split (`S`), merge (`M`), trim, move, and re-order clips with full UNDO/REDO support.
* **Clip Boundary Constraints**: Enforces standard clip duration limits (minimum 1.0s, maximum 25.0s) while maintaining alignment.
* **Time-Stretch Preview**: Real-time video playback rate matching clip slot durations seamlessly during preview playback.

### 🤖 Generative AI Suite
* **Text-to-Video**: Generate high-fashion video clips from prompts styled for dark, metallic, or cyber-organic aesthetics.
* **Image-to-Video & Video-to-Video**: Animate still lookbook images or transform existing video assets with custom AI prompts.
* **Character Avatars & Lip-Sync**: Create virtual avatars or upload model photos to perform lip-synced rap performances.

### 📁 Media Library & Asset Management
* **Custom Folders & Tagging**: Organize images, lookbook photos, and video assets into custom folders.
* **Extract Last Frame**: Extract the final frame of any generated video to pass as the starting frame for contiguous video continuation.
* **Project Persistence**: Auto-saves timeline state, clips, markers, and audio metadata to local storage or AWS S3.

---

## 📂 Architecture & Workspace Structure

MVS uses a clean monorepo architecture with clean separation between frontend, backend API, and shared types:

```text
├── apps/
│   ├── api/                   # Fastify backend, storage routing, and generation coordinators
│   │   ├── src/
│   │   │   ├── config.ts      # Strict Zod environment variable parser
│   │   │   ├── server.ts      # REST API endpoints, upload handlers, and CORS/proxy logic
│   │   │   ├── storage.ts     # S3 / CloudFront bucket & Local filesystem storage provider
│   │   │   └── audio.ts       # Audio processing & analysis coordination
│   │   └── storage/           # Local storage directory fallback
│   │
│   └── web/                   # React 18 SPA built with Vite and Tailwind CSS
│       ├── src/
│       │   ├── components/    # Timeline, Waveform, VideoPreview, Sidebar, Library, Header
│       │   ├── lib/           # Zustand state store, API client, WaveSurfer helpers
│       │   └── routes/        # Main editor workspace
│       └── vite.config.ts     # Vite configuration with backend reverse proxy error handling
│
├── packages/
│   └── shared/                # Zod schemas and TypeScript type definitions shared across web & api
│       └── src/index.ts
│
├── modal/                     # Modal Python GPU microservices (Audio analysis, LTX-Video, Media Suite)
├── .env.example               # Complete environment variable template
├── package.json               # Monorepo root workspace configuration
└── vitest.config.ts           # Vitest unit test runner setup
```

---

## 🚀 Installation & Local Setup

### 📋 Prerequisites
* **Node.js**: v18.0.0 or higher
* **npm**: v9.0.0 or higher (or `bun` / `pnpm`)
* **Python**: 3.10+ (only required if deploying custom Modal GPU workers)

### 🛠️ Quickstart

1. **Clone the repository and install dependencies**:
   ```bash
   git clone https://github.com/your-org/music-video-studio.git
   cd music-video-studio
   npm install
   ```

2. **Configure Environment Variables**:
   ```bash
   cp .env.example .env
   ```
   *(Edit `.env` with your desired configuration or AWS S3 credentials as detailed in the section below).*

3. **Start Development Mode**:
   ```bash
   npm run dev
   ```
   This boots both the backend API server (`http://localhost:3001`) and the Vite frontend dev server (`http://localhost:3000`) concurrently.

4. **Access the Application**:
   Open `http://localhost:3000` in your web browser.

---

## ⚙️ Configuration & Environment Variables

All server and API configuration is strictly typed and validated at startup using Zod in `apps/api/src/config.ts`.

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `3001` | Port number for the backend Fastify API server. |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | External base URL used to construct public URLs for assets. |
| `WEB_ORIGIN` | `http://localhost:3000` | Configures CORS allowed origins for web requests. |
| `STORAGE_BACKEND` | `s3` | Storage mode: `s3` for AWS S3 bucket storage or `local` for local disk. |
| `STORAGE_DIR` | `s3://.../renders/` | S3 URI prefix or local directory path for rendered files. |
| `S3_BUCKET` | *(configured)* | AWS S3 Bucket name storing project assets and renders. |
| `S3_REGION` | `us-east-1` | AWS S3 Region. |
| `AWS_ACCESS_KEY_ID` | *(environment)* | AWS Access Key ID for bucket access. |
| `AWS_SECRET_ACCESS_KEY` | *(environment)* | AWS Secret Access Key for bucket access. |
| `MODAL_LTX_URL` | *(configured)* | Modal GPU Endpoint for LTX-Video v2.3 clip generation. |
| `MODAL_AUDIO_URL` | *(configured)* | Modal GPU Endpoint for audio analysis & beat tracking. |
| `MODAL_MEDIA_SUITE_URL` | *(configured)* | Modal Endpoint for Text-to-Image / Avatar generation. |

---

## ⚡ Modal Pipeline & GPU Microservices

The generative video pipeline runs on dedicated Modal GPU workers in Python. All Python scripts are located in the `/modal` directory.

### Modal Deploy Commands:
1. **Audio Analysis Worker** (BPM, beat tracking, onset transients):
   ```bash
   modal deploy modal/audio_analysis.py
   ```
2. **LTX-Video v2.3 Worker** (Generates 24fps joint audio-video on A100-80GB GPUs):
   ```bash
   modal deploy modal/ltx_video.py
   ```
3. **Media Suite Worker** (Text-to-Image / SDXL on A10G GPUs):
   ```bash
   modal deploy modal/media_suite.py
   ```

---

## 📖 Step-by-Step User Guide

### 1. Uploading an Audio Track
1. Open the MVS application in your browser.
2. Drag and drop an audio file (`.mp3`, `.wav`, `.m4a`) onto the main drop zone, or click **"Drop a tune"** to select a file.
3. The server automatically analyzes the audio for BPM, key signature, downbeats, and transients.
4. The timeline renders the audio waveform along with automatic beat markers and section cuts.

### 2. Timeline Controls & Shortcuts
* **Play / Pause**: Press `Spacebar` or click the Play button.
* **Seek**: Click anywhere on the waveform or time ruler.
* **Split Clip**: Select a clip and press `S` (or click **Split at Playhead**).
* **Merge Clips**: Select contiguous clips and press `M` (or click **Merge Right**).
* **Zoom Waveform**: Press `+` to zoom in, `-` to zoom out, or `0` to fit the entire song on screen.
* **Navigate**: Press `Home` to return playhead to `0:00`.

### 3. Generating AI Video Clips
1. Click on any empty clip segment on the timeline.
2. In the right-hand **Inspector Panel**, select the desired **Generation Mode**:
   * **Text to Video**: Enter a prompt (e.g., *"Dark chrome Zippo lighter flicking open, intense amber flame, high-contrast spotlight"*).
   * **Image to Video**: Select a reference image from your library or avatar collection, then enter a motion prompt.
   * **Lip Sync**: Select a character avatar and align with the audio segment.
3. Click **Generate Clip**.
4. The timeline updates to a **Generating** state while the Modal GPU pipeline processes the task in the background. Once complete, the clip renders in real-time in the video preview.

### 4. Managing Avatars & Library Assets
1. Open the **Library** tab in the sidebar.
2. Upload reference lookbook photos, background textures, or character avatars.
3. Organize assets into custom folders for rapid access during scene creation.

### 5. Exporting & Rendering Final Video
1. Review your timeline sequence in the **Video Preview** window.
2. Click **Render Video** in the top navigation bar.
3. The system compiles all audio-aligned clips and background tracks into a final high-resolution MP4.
4. Download the final video directly to your device.

---

## 🧪 Testing & Quality Assurance

MVS includes unit tests for state management, timeline boundary constraints, and network storage functions using Vitest.

* **Run all tests**:
  ```bash
  npm test
  ```
* **Run linter and TypeScript verification**:
  ```bash
  npm run lint
  ```
* **Verify production build compilation**:
  ```bash
  npm run build
  ```

---

## ❓ Troubleshooting & Frequently Asked Questions

### Q: "Audio file could not be loaded (404 Not Found)"
* **Cause**: Temporary audio files or presigned S3 URLs may have expired or been moved.
* **Solution**: Click the **Re-upload Audio** button on the timeline overlay to refresh the audio track without losing your clip cuts and timeline layout.

### Q: API returns 503 Service Unavailable when launching
* **Cause**: The backend API server is initializing or restarting.
* **Solution**: The frontend automatically handles 503 proxy responses with JSON error notices and retries cleanly once the server is ready.

### Q: Video generation task shows "Failed" or time-outs
* **Cause**: The Modal GPU worker may be cold-starting or experiencing GPU quota limits.
* **Solution**: Check your `MODAL_LTX_URL` in `.env` and verify that the Modal GPU function is deployed and active.

---

## 🚢 Production Deployment & Render Setup Guide

### Option 1: Deploying with Render Blueprint (`render.yaml`) [Recommended]

Render's Infrastructure-as-Code Blueprint feature automatically reads `render.yaml` from your repository root and sets up the Web Service, build commands, and environment variables.

1. **Push Code to GitHub**:
   Ensure your repository includes `render.yaml`, `Dockerfile`, `package.json`, and all source files.

2. **Connect Repository in Render**:
   - Log in to [Render Dashboard](https://dashboard.render.com).
   - Click **New +** -> **Blueprint**.
   - Connect your GitHub / GitLab repository containing MVS.
   - Render will detect `render.yaml` automatically and configure the service `music-video-studio`.

3. **Configure Environment Secrets on Render**:
   In the Render dashboard under **Environment Variables**, populate the required secrets:
   - `S3_BUCKET`: Your AWS S3 Bucket Name
   - `AWS_ACCESS_KEY_ID`: Your AWS Access Key ID
   - `AWS_SECRET_ACCESS_KEY`: Your AWS Secret Access Key
   - `AWS_REGION`: `us-east-1` (or your S3 region)
   - `PUBLIC_BASE_URL`: The production URL provided by Render (e.g. `https://music-video-studio.onrender.com`)
   - `MODAL_AUDIO_URL`: Your deployed Modal audio analysis endpoint URL
   - `MODAL_LTX_URL`: Your deployed Modal LTX-Video endpoint URL
   - `MODAL_MEDIA_SUITE_URL`: Your deployed Modal Media Suite endpoint URL

4. **Deploy Service**:
   Click **Apply**. Render will run the build command (`pnpm install && pnpm --filter @mvs/web build && pnpm --filter @mvs/api build`) and launch `node apps/api/dist/server.js`. The single server will automatically host both the REST API endpoints and serve the static React frontend from `./apps/web/dist`.

---

### Option 2: Deploying as a Docker Container on Render

MVS includes a multi-stage production `Dockerfile` with `ffmpeg` preinstalled for video frame processing.

1. **Create Web Service on Render**:
   - Click **New +** -> **Web Service**.
   - Select **Build and deploy from a Git repository**.
   - Environment: Select **Docker**.

2. **Configure Docker Deployment**:
   - **Dockerfile Path**: `./Dockerfile`
   - **Region**: Select your preferred region.
   - **Instance Type**: Starter ($7/mo) or higher recommended.

3. **Set Environment Variables**:
   Add the following environment variables in the Render console:
   ```text
   NODE_ENV=production
   PORT=10000
   STORAGE_BACKEND=s3
   S3_BUCKET=<your-s3-bucket-name>
   AWS_ACCESS_KEY_ID=<your-aws-key>
   AWS_SECRET_ACCESS_KEY=<your-aws-secret>
   AWS_REGION=us-east-1
   PUBLIC_BASE_URL=https://<your-render-app>.onrender.com
   MODAL_AUDIO_URL=<your-modal-audio-url>
   MODAL_LTX_URL=<your-modal-ltx-url>
   MODAL_MEDIA_SUITE_URL=<your-modal-media-suite-url>
   ```

4. **Deploy**:
   Click **Create Web Service**. Render will build the Docker container and start serving MVS on port `10000`.

---

*Keep Em' Thirsty — Created with AI Music Video Studio (MVS).*

# Videos
