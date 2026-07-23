# Render deployment settings

This repository uses one Render **Node Web Service**. The Fastify API serves the built React application, so a separate Static Site is not required.

## Existing service settings

Update the existing Render service with these values:

| Setting | Value |
|---|---|
| Service type | Web Service |
| Runtime | Node |
| Branch | `main` |
| Root Directory | Leave blank |
| Build Command | `npm ci --include=dev --no-audit --no-fund && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Auto Deploy | On Commit |

## Environment and data

Do not replace or import environment variables from this repository. Keep the environment variables already configured in the Render dashboard.

The `render.yaml` intentionally omits `envVars`. Render preserves existing service environment variables that are omitted from a Blueprint.

This change does not create, replace, migrate, or delete a database or S3 data.

## After committing

1. In Render, open the existing service.
2. Update the build, start, branch, root-directory, health-check, and auto-deploy settings to match the table above.
3. Select **Manual Deploy → Clear build cache & deploy** for the first deployment after this change.
4. Confirm that `/health` returns a successful response.
