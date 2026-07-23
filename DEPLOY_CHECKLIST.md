# Deploy checklist

Use this order so Render does not call an undeployed Modal endpoint.

## 1. Rotate the old AWS keys

The uploaded archive contained an environment export with AWS credentials. Delete or deactivate those keys in AWS IAM and create new ones before using S3 again. The environment export has been removed from this cleaned repository.

## 2. Deploy LTX-2.3 on Modal

From the repository folder:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install modal
modal setup
modal deploy modal/ltx_video.py
```

Copy the URL ending in `mvs-ltx-video-generate.modal.run`.

## 3. Update Render environment variables

In Render, open the `music-video-studio` service and set:

```text
PUBLIC_BASE_URL=https://YOUR-SERVICE.onrender.com
WEB_ORIGIN=https://YOUR-SERVICE.onrender.com
MODAL_LTX_URL=https://YOUR-WORKSPACE--mvs-ltx-video-generate.modal.run
```

For temporary testing without S3:

```text
STORAGE_BACKEND=local
```

For permanent storage, set `STORAGE_BACKEND=s3` and provide all of:

```text
S3_BUCKET
S3_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```

Do not set `API_AUTH_TOKEN` yet unless the browser is also updated to send it.

## 4. Redeploy Render

Push this repaired source to GitHub, then in Render choose **Manual Deploy → Clear build cache & deploy**.

Expected commands from `render.yaml`:

```text
Build: npm ci --include=dev --no-audit --no-fund && npm run build
Start: npm start
```

## 5. Verify

Open:

```text
https://YOUR-SERVICE.onrender.com/health
```

It should return:

```json
{"ok":true}
```

Then select the first timeline segment and generate a 1–5 second **Text → Video** clip from the LTX-2.3 sidebar. Render logs should show a job launch and later a `POST /api/modal/webhook`. Modal logs should show the model loading and the completed MP4 URL.

## Common failure messages

- `MODAL_LTX_URL is not configured`: the Render variable is missing or points to the wrong endpoint.
- `Could not reach the Modal LTX service`: Modal is not deployed, the URL is wrong, or proxy credentials do not match.
- A task remains `RUNNING`: confirm `PUBLIC_BASE_URL` is the exact public Render URL and that Modal can post to `/api/modal/webhook`.
- Render cannot start after S3 errors: use `STORAGE_BACKEND=local` temporarily or provide the complete S3 credential set.
