import { z } from "zod";

const optionalUrl = z
  .string()
  .transform((value) => (value.trim() === "" ? undefined : value.trim()))
  .pipe(z.string().url().optional());

const optionalNonEmpty = z
  .string()
  .transform((value) => (value.trim() === "" ? undefined : value.trim()))
  .pipe(z.string().min(1).optional());

const Env = z.object({
  LOCAL_INFERENCE_URL: optionalUrl.optional(),
  MODAL_AUDIO_URL: optionalUrl.optional(),
  MODAL_LTX_URL: optionalUrl.optional(),
  MODAL_MEDIA_SUITE_URL: optionalUrl.optional(),
  MODAL_LIPSYNC_URL: optionalUrl.optional(),
  MODAL_FILE_RESOLVER_URL: optionalUrl.optional(),
  MODAL_KEY: optionalNonEmpty.optional(),
  MODAL_SECRET: optionalNonEmpty.optional(),
  API_AUTH_TOKEN: optionalNonEmpty.optional(),
  PORT: z.coerce.number().default(3001),
  PUBLIC_BASE_URL: optionalUrl.optional(),
  WEB_ORIGIN: z.string().default(""),
  STORAGE_DIR: z.string().default("apps/api/storage"),
  STORAGE_BACKEND: z.enum(["local", "s3"]).default("local"),
  S3_BUCKET: optionalNonEmpty.optional(),
  S3_REGION: optionalNonEmpty.optional(),
  AWS_REGION: optionalNonEmpty.optional(),
  AWS_ACCESS_KEY_ID: optionalNonEmpty.optional(),
  AWS_SECRET_ACCESS_KEY: optionalNonEmpty.optional(),
  S3_PUBLIC_URL_BASE: optionalUrl.optional(),
  WEB_DIST_DIR: optionalNonEmpty.optional(),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("invalid env:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("\nPlease review the environment variables in your Render dashboard.");
  process.exit(1);
}

const env = parsed.data;
const storageRegion = env.S3_REGION ?? env.AWS_REGION;
let storageBackend = env.STORAGE_BACKEND;

// Render does not provide an AWS instance role. When S3 was selected without a
// complete credential set, every library request failed at runtime. Keep the app
// online by falling back to local storage and log exactly what needs fixing.
if (storageBackend === "s3") {
  const missing: string[] = [];
  if (!env.S3_BUCKET) missing.push("S3_BUCKET");
  if (!storageRegion) missing.push("S3_REGION or AWS_REGION");
  if (!env.AWS_ACCESS_KEY_ID) missing.push("AWS_ACCESS_KEY_ID");
  if (!env.AWS_SECRET_ACCESS_KEY) missing.push("AWS_SECRET_ACCESS_KEY");

  if (missing.length > 0) {
    console.warn(
      `STORAGE_BACKEND=s3 is incomplete (${missing.join(", ")}). ` +
        "Falling back to local storage so the service can start."
    );
    storageBackend = "local";
  }
}

export const config = {
  ...env,
  S3_REGION: storageRegion,
  STORAGE_BACKEND: storageBackend,
};

if (!config.MODAL_LTX_URL) {
  console.log("INFO: MODAL_LTX_URL is missing. Video generation is offline.");
}
if (!config.MODAL_AUDIO_URL) {
  console.log("INFO: MODAL_AUDIO_URL is missing. Music analysis is offline.");
}
if (!config.MODAL_MEDIA_SUITE_URL) {
  console.log("INFO: MODAL_MEDIA_SUITE_URL is missing. Character creation is offline.");
}
if (!config.MODAL_LIPSYNC_URL) {
  console.log("INFO: MODAL_LIPSYNC_URL is missing. Lip-sync is offline.");
}

export type Config = typeof config;
