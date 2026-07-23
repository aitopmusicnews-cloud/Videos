# Music Video Studio

A React/Fastify music-video editor with audio analysis, timeline editing, rendering, and open-weight LTX-2.3 video generation on Modal.

## What is currently wired up

- React 19 + Vite web editor
- Fastify 5 TypeScript API
- Local or S3-backed project/media storage
- Audio analysis and final timeline rendering
- LTX-2.3 text-to-video, first-frame image-to-video, and previous-clip continuation
- Native synchronized audio generated with every LTX-2.3 clip
- Modal webhook callbacks with task polling in the browser
- An LTX-only editor sidebar; legacy avatar, standalone image-generation, and non-LTX restyle controls are hidden

The UI intentionally exposes only the workflows connected to `modal/ltx_video.py`. Other experimental services remain outside the editor workflow.

## LTX-only editor workflow

Select a timeline clip and choose one of three modes in the right sidebar:

1. **Text → Video** for a prompt-only audio/video generation.
2. **Image → Video** for animation from one uploaded reference frame.
3. **Continue Previous Clip** to use the prior clip's final frame as the next clip's first frame.

The deployed Modal worker currently renders 1–5 second clips at 768×512 and 24 FPS. The first timeline clip defaults to Text → Video so a new project can start without an existing image or clip.

## Repository layout

```text
apps/web/           React editor
apps/api/           Fastify API and render/storage services
packages/shared/    Shared Zod schemas and TypeScript types
modal/              Modal GPU/CPU services
render.yaml         Render Blueprint configuration
```

## Local setup

Requirements:

- Node.js 20 or 22
- npm 10+
- Python 3.12 and the Modal CLI only when deploying Modal workers
- ffmpeg for local audio/video processing

```bash
git clone https://github.com/aitopmusicnews-cloud/Videos.git
cd Videos
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`. The API runs on `http://localhost:3001`.

## Build and checks

```bash
npm run build
npm run lint
```

`npm run build` performs these steps in order:

1. Builds `@mvs/shared` into `packages/shared/dist`
2. Type-checks and builds the Vite frontend into `apps/web/dist`
3. Compiles the Fastify API into `apps/api/dist`

The production start command is:

```bash
npm start
```

## Deploy LTX-2.3 to Modal

Install and authenticate the Modal CLI:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install modal
modal setup
```

Deploy the LTX worker from the repository root:

```bash
modal deploy modal/ltx_video.py
```

The command prints endpoints similar to:

```text
https://YOUR-WORKSPACE--mvs-ltx-video-generate.modal.run
https://YOUR-WORKSPACE--mvs-ltx-video-get-file.modal.run
```

The worker uses the open-weight `diffusers/LTX-2.3-Distilled-Diffusers` checkpoint, synchronized audio/video output, eight inference steps, and an A100-80GB GPU. The first request may be slow while the model downloads into the `mvs-ltx-models` Modal Volume.

Test the deployed generation endpoint:

```bash
curl -X POST "$MODAL_LTX_URL" \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "A cinematic nighttime performance beneath orange neon lights",
    "duration": 4
  }'
```

A successful launch returns an accepted job and Modal call ID immediately. The GPU work continues asynchronously.

## Render deployment

The included `render.yaml` uses npm consistently and builds both the frontend and API.

Create or update the service through a Render Blueprint, then set these environment variables in Render:

```text
PUBLIC_BASE_URL=https://YOUR-SERVICE.onrender.com
WEB_ORIGIN=https://YOUR-SERVICE.onrender.com
MODAL_LTX_URL=https://YOUR-WORKSPACE--mvs-ltx-video-generate.modal.run
```

For persistent S3 storage, also set all four values:

```text
STORAGE_BACKEND=s3
S3_BUCKET=your-bucket
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

When the S3 configuration is incomplete, the API deliberately falls back to local storage so the Render service can still start. Render local storage is ephemeral, so configure S3 before relying on saved projects or uploaded media.

Optional Modal proxy-token protection:

```text
MODAL_KEY=wk-...
MODAL_SECRET=ws-...
```

Render should run:

```text
Build: npm ci --include=dev --no-audit --no-fund && npm run build
Start: npm start
Health check: /health
```

## Generation request flow

1. The browser submits a generation request to the Fastify API.
2. The API creates a persistent job record and calls the Modal endpoint.
3. Modal immediately spawns the A100 generation function and returns a call ID.
4. The browser polls `/api/tasks/:id` through the Fastify API.
5. When generation finishes, Modal posts the result to `/api/modal/webhook`.
6. The task endpoint returns `SUCCEEDED` and the generated MP4 URL.

## Troubleshooting

### Render builds but cannot start

Confirm that the deploy is using the current `render.yaml`. The previous API TypeScript configuration inherited `noEmit: true`, which meant `apps/api/dist/server.js` was never created. The repaired configuration emits the server build.

### Render reports missing AWS credentials

Set every S3 variable listed above, or temporarily set `STORAGE_BACKEND=local`.

### Video generation stays pending

Check all of the following:

- `MODAL_LTX_URL` is the deployed `generate` endpoint, not the file endpoint.
- `PUBLIC_BASE_URL` exactly matches the public Render service URL.
- The Modal app is deployed and its logs show the LTX model loading.
- Render can receive `POST /api/modal/webhook` requests.
- If Modal proxy authentication is enabled, both `MODAL_KEY` and `MODAL_SECRET` are set in Render.

### Modal deployment fails while importing LTX classes

Redeploy from the repaired `modal/ltx_video.py`. It installs a current Diffusers build directly from Hugging Face’s GitHub repository because LTX-2.3 support requires recent Diffusers code.

## Security

Never commit `.env`, Render exports, AWS keys, Modal secrets, uploaded media, virtual environments, logs, or generated build output. These paths are covered by `.gitignore`.
