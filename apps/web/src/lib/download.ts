import { toast } from "./toast.js";
import { getErrorMessage } from "@mvs/shared";

/**
 * Force a browser download of a remote URL via blob fetch + temporary anchor
 * click. The plain `<a download>` attribute is ignored for cross-origin URLs
 * (PUBLIC_BASE_URL is on a different port than the dev page, S3 is a third
 * origin), so the link just opens the file inline. Fetching as a blob and
 * synthesizing the anchor sidesteps that.
 *
 * Requires CORS on the source — Fastify already allows the web origin in dev,
 * and S3 needs a bucket CORS policy in prod.
 */
export async function downloadFromUrl(url: string, filename: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    toast.error(`Download failed: ${getErrorMessage(err)}`);
    throw err;
  }
}
