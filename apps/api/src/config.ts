import { z } from "zod";

const optionalUrl = z
  .string()
  .transform((v) => (v.trim() === "" ? undefined : v))
  .pipe(z.string().url().optional());

const optionalNonEmpty = z
  .string()
  .transform((v) => (v.trim() === "" ? undefined : v))
  .pipe(z.string().min(1).optional());

const Env = z.object({
  LOCAL_INFERENCE_URL: optionalUrl.optional(),
  MODAL_AUDIO_URL: optionalUrl.optional(),
  MODAL_LTX_URL: optionalUrl.optional(), 
  MODAL_MEDIA_SUITE_URL: optionalUrl.optional(),
  MODAL_LIPSYNC_URL: optionalUrl.optional(),
  MODAL_FILE_RESOLVER_URL: optionalUrl.optional(),
  PORT: z.coerce.number().default(3001),
  PUBLIC_BASE_URL: z.string().url().default("https://onrender.com"),
  WEB_ORIGIN: z.string().default("https://onrender.com"),
  STORAGE_DIR: z.string().default("apps/api/storage"),
  STORAGE_BACKEND: z.enum(["local", "s3"]).default("local"),
  S3_BUCKET: optionalNonEmpty.optional(),
  S3_REGION: optionalNonEmpty.optional(),
  S3_PUBLIC_URL_BASE: optionalUrl.optional(),
  WEB_DIST_DIR: optionalNonEmpty.optional(),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("invalid env:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("\nPlease review environment setup properties in your Render dashboard config settings.");
  process.exit(1);
}

export const config = parsed.data;

// Health Checks & Boot Diagnostics
if (!config.MODAL_LTX_URL) {
  console.log("INFO: MODAL_LTX_URL is missing. Video processing generation paths are offline.");
}
if (!config.MODAL_AUDIO_URL) {
  console.log("INFO: MODAL_AUDIO_URL is missing. Music analysis features are offline.");
}
if (!config.MODAL_MEDIA_SUITE_URL) {
  console.log("INFO: MODAL_MEDIA_SUITE_URL is missing. Character creation pipeline is offline.");
}
if (!config.MODAL_LIPSYNC_URL) {
  console.log("INFO: MODAL_LIPSYNC_URL is missing. Lip-Sync animation features are offline.");
}
if (!config.MODAL_FILE_RESOLVER_URL) {
  console.log("INFO: MODAL_FILE_RESOLVER_URL is missing. Media stream tracking is offline.");
}

if (config.STORAGE_BACKEND === "s3") {
  if (!config.S3_BUCKET || !config.S3_REGION) {
    console.warn("INFO: STORAGE_BACKEND is set to 's3' but S3_BUCKET or S3_REGION is missing. Falling back to STORAGE_BACKEND='local'.");
    (config as any).STORAGE_BACKEND = "local";
    (config as any).STORAGE_DIR = "apps/api/storage";
  }
}

export type Config = z.infer<typeof Env>;
