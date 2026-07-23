# Modal services

## LTX-2.3 video worker

`ltx_video.py` deploys two public Modal web functions:

- `generate`: accepts a prompt and optional first-frame image, then immediately spawns GPU work
- `get_file`: serves completed MP4 files from the `mvs-ltx-outputs` Volume

The GPU class uses:

- `diffusers/LTX-2.3-Distilled-Diffusers`
- A100-80GB
- 768×512 at 24 fps
- 1–5 second clips
- synchronized generated audio
- text-to-video or first-frame image conditioning
- webhook completion callbacks

Deploy from the repository root:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install modal
modal setup
modal deploy modal/ltx_video.py
```

Copy the generated `generate` URL into the Render environment as `MODAL_LTX_URL`.

Test it directly:

```bash
export MODAL_LTX_URL=https://YOUR-WORKSPACE--mvs-ltx-video-generate.modal.run
curl -X POST "$MODAL_LTX_URL" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"A dramatic performance in a chrome tunnel","duration":4}'
```

The endpoint returns `status: accepted`. Completion is asynchronous. In normal app usage, Modal calls the Render API webhook supplied in the request.

## Other workers

- `audio_analysis.py`: audio feature extraction
- `media_suite.py`: SDXL image generation plus an unfinished lip-sync placeholder

Do not advertise the lip-sync path as complete until a real inference implementation writes the returned MP4 to the output Volume.
