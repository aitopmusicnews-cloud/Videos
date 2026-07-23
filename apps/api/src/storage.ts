import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, rename, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  type _Object,
} from "@aws-sdk/client-s3";
import { AudioAnalysis } from "@mvs/shared";
import { config } from "./config.js";
import { mimeType } from "./paths.js";

export class CorruptAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorruptAnalysisError";
  }
}

const UPLOADS = join(config.STORAGE_DIR, "uploads");
const ANALYSES = join(config.STORAGE_DIR, "analyses");
const RENDERS = join(config.STORAGE_DIR, "renders");

// Only the local backend writes to these directories. In s3 mode the API
// streams directly to S3 — creating empty dirs here would just clutter the
// Fargate disk. RENDERS is still needed transiently in s3 mode (ffmpeg
// writes the mp4 there before saveRender ships it), but `renderTimeline`
// already runs `mkdir(paths.RENDERS, { recursive: true })` on every call.
if (config.STORAGE_BACKEND === "local") {
  await ensureDir(UPLOADS);
  await ensureDir(ANALYSES);
  await ensureDir(RENDERS);
}

export async function ensureDir(p: string) {
  if (!existsSync(p)) await mkdir(p, { recursive: true });
}

export function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

export const paths = { UPLOADS, ANALYSES, RENDERS };

export interface FileEntry {
  /** Key relative to the storage root (e.g. "renders/abc.mp4"). */
  key: string;
  publicUrl: string;
  size: number;
  modifiedAt: string;
}

// --- Storage backend abstraction ---------------------------------------
//
// Two implementations:
//   - local: writes to STORAGE_DIR; URLs go through Fastify's static serve.
//     Fine for dev. On Fargate, container-local disk is ephemeral, so
//     production runs the s3 backend.
//   - s3:    PutObject to S3_BUCKET; URLs are virtual-hosted-style or
//            S3_PUBLIC_URL_BASE (CloudFront). Survives container restarts.
//
// Both backends expose JSON metadata helpers (saveJson/loadJson/...) so
// project, clip, image and analysis sidecars persist across task replacement
// on Fargate (previously these were node-fs writes to ephemeral disk).

export interface StorageBackend {
  /** Persist an uploaded blob. Idempotent on content (same buffer → same id). */
  saveUpload(
    buf: Buffer,
    originalName: string,
    contentType?: string
  ): Promise<{ id: string; publicUrl: string }>;
  /** Persist a finished render produced at a local file path.
   *  - local backend: renames the file into the renders/ directory.
   *  - s3 backend: uploads the bytes; the local file is left on disk and the
   *    caller is expected to unlink it (renderTimeline does so on Fargate
   *    where the 20 GiB ephemeral disk would otherwise fill up). */
  saveRender(localPath: string, key: string, contentType?: string): Promise<{ publicUrl: string }>;

  /** Write a JSON metadata document at `key`. Overwrites any existing object. */
  saveJson(key: string, data: unknown): Promise<void>;
  /** Read+parse a JSON metadata document. Returns null when missing. */
  loadJson<T>(key: string): Promise<T | null>;
  /** Return every `.json` key under `prefix` (recursive). */
  listJson(prefix: string): Promise<string[]>;
  /** Remove a JSON metadata document. Returns true when it existed. */
  deleteJson(key: string): Promise<boolean>;

  /** List arbitrary files (e.g. renders/*.mp4). Recursive. */
  listFiles(prefix: string): Promise<FileEntry[]>;
}

class LocalBackend implements StorageBackend {
  private fsPath(key: string): string {
    return join(config.STORAGE_DIR, key);
  }

  private publicUrl(key: string): string {
    return `/storage/${key}`;
  }

  async saveUpload(buf: Buffer, originalName: string) {
    const id = hashBuffer(buf);
    const ext = extname(originalName) || ".bin";
    const filename = `${id}${ext}`;
    const path = join(UPLOADS, filename);
    try {
      await writeFile(path, buf, { flag: "wx" });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    return { id, publicUrl: this.publicUrl(`uploads/${filename}`) };
  }

  async saveRender(localPath: string, key: string) {
    const dest = join(RENDERS, key);
    if (localPath !== dest) await rename(localPath, dest);
    return { publicUrl: this.publicUrl(`renders/${key}`) };
  }

  async saveJson(key: string, data: unknown): Promise<void> {
    const path = this.fsPath(key);
    await ensureDir(dirname(path));
    await writeFile(path, JSON.stringify(data, null, 2));
  }

  async loadJson<T>(key: string): Promise<T | null> {
    const path = this.fsPath(key);
    if (!existsSync(path)) return null;
    return JSON.parse(await readFile(path, "utf8")) as T;
  }

  async listJson(prefix: string): Promise<string[]> {
    const dir = this.fsPath(prefix);
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    await walkDir(dir, async (filePath) => {
      if (!filePath.endsWith(".json")) return;
      const rel = filePath.slice(config.STORAGE_DIR.length + 1).split("\\").join("/");
      out.push(rel);
    });
    return out;
  }

  async deleteJson(key: string): Promise<boolean> {
    const path = this.fsPath(key);
    if (!existsSync(path)) return false;
    await rm(path, { force: true });
    return true;
  }

  async listFiles(prefix: string): Promise<FileEntry[]> {
    const dir = this.fsPath(prefix);
    if (!existsSync(dir)) return [];
    const out: FileEntry[] = [];
    await walkDir(dir, async (filePath) => {
      const s = await stat(filePath);
      const rel = filePath.slice(config.STORAGE_DIR.length + 1).split("\\").join("/");
      out.push({
        key: rel,
        publicUrl: this.publicUrl(rel),
        size: s.size,
        modifiedAt: s.mtime.toISOString(),
      });
    });
    return out;
  }
}

async function walkDir(dir: string, visit: (filePath: string) => Promise<void>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walkDir(p, visit);
    else if (e.isFile()) await visit(p);
  }
}

class S3Backend implements StorageBackend {
  private client: S3Client;
  private bucket: string;
  private region: string;
  private publicBase: string;

  constructor() {
    this.bucket = config.S3_BUCKET!;
    this.region = config.S3_REGION!;
    this.client = new S3Client({ region: this.region });
    this.publicBase =
      config.S3_PUBLIC_URL_BASE ?? `https://${this.bucket}.s3.${this.region}.amazonaws.com`;
  }

  private url(key: string): string {
    return `${this.publicBase}/${key}`;
  }

  async saveUpload(buf: Buffer, originalName: string, contentType?: string) {
    const id = hashBuffer(buf);
    const ext = extname(originalName) || ".bin";
    const key = `uploads/${id}${ext}`;

    // Skip the upload if the same content is already there. PutObject is idempotent
    // on identical bodies but a HEAD round-trip is cheaper than re-uploading large audio.
    const existing = await this.head(key);
    if (!existing) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buf,
          ContentType: contentType ?? mimeType(ext),
          CacheControl: "public, max-age=31536000, immutable",
        })
      );
    }
    return { id, publicUrl: this.url(key) };
  }

  async saveRender(localPath: string, key: string, contentType?: string) {
    const objectKey = `renders/${key}`;
    const ext = extname(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: await readFile(localPath),
        ContentType: contentType ?? mimeType(ext),
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    return { publicUrl: this.url(objectKey) };
  }

  async saveJson(key: string, data: unknown): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(data),
        ContentType: "application/json",
        // Metadata JSON gets overwritten on every save; tell any caches not
        // to keep a copy. (`no-cache` would still allow stale-while-revalidate
        // semantics — `no-store` is the no-caching directive we actually want.)
        CacheControl: "no-store, max-age=0",
      })
    );
  }

  async loadJson<T>(key: string): Promise<T | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key })
      );
      const body = await res.Body?.transformToString();
      if (!body) return null;
      return JSON.parse(body) as T;
    } catch (err: unknown) {
      if (isNoSuchKey(err)) return null;
      throw err;
    }
  }

  async listJson(prefix: string): Promise<string[]> {
    const all = await this.listAll(prefix);
    return all.filter((o) => o.Key?.endsWith(".json")).map((o) => o.Key!);
  }

  async deleteJson(key: string): Promise<boolean> {
    // S3 DeleteObject is idempotent and doesn't tell us if the key existed.
    // Do a HEAD first so callers (e.g. DELETE /projects/:id) can return 404.
    if (!(await this.head(key))) return false;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    return true;
  }

  async listFiles(prefix: string): Promise<FileEntry[]> {
    const all = await this.listAll(prefix);
    return all
      .filter((o) => o.Key)
      .map((o) => ({
        key: o.Key!,
        publicUrl: this.url(o.Key!),
        size: o.Size ?? 0,
        modifiedAt: o.LastModified?.toISOString() ?? new Date(0).toISOString(),
      }));
  }

  private async listAll(prefix: string): Promise<_Object[]> {
    const out: _Object[] = [];
    let ContinuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken,
        })
      );
      out.push(...(page.Contents ?? []));
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return out;
  }

  private async head(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}

function isNoSuchKey(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NoSuchKey" || e.Code === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

export const storage: StorageBackend =
  config.STORAGE_BACKEND === "s3"
    ? new S3Backend()
    : new LocalBackend();

// Convenience wrapper used by the upload endpoints.
export async function saveUpload(buf: Buffer, originalName: string, contentType?: string) {
  return storage.saveUpload(buf, originalName, contentType);
}

// --- Analysis cache ------------------------------------------------------
// Lives at analyses/<songId>.json (or .error.json / .vocal.json). Goes
// through the storage backend so cached analyses survive task replacement
// (S3 in prod, local disk in dev).

export async function readAnalysis(songId: string): Promise<AudioAnalysis | null> {
  const parsed = await storage.loadJson<unknown>(`analyses/${songId}.json`);
  if (!parsed) return null;
  const result = AudioAnalysis.safeParse(parsed);
  if (!result.success) {
    throw new CorruptAnalysisError(
      `analysis cache for ${songId} does not match schema: ${result.error.message}`
    );
  }
  return result.data;
}

export async function writeAnalysis(songId: string, data: AudioAnalysis): Promise<void> {
  await storage.saveJson(`analyses/${songId}.json`, data);
}

export async function writeAnalysisError(songId: string, error: string): Promise<void> {
  await storage.saveJson(`analyses/${songId}.error.json`, { error });
}

export async function readAnalysisError(songId: string): Promise<string | null> {
  const parsed = await storage.loadJson<{ error?: string }>(`analyses/${songId}.error.json`);
  return parsed?.error ?? null;
}

export async function clearAnalysisError(songId: string): Promise<void> {
  await storage.deleteJson(`analyses/${songId}.error.json`);
}

export async function readVocalStemUrl(songId: string): Promise<string | null> {
  const parsed = await storage.loadJson<{ url?: string }>(`analyses/${songId}.vocal.json`);
  return typeof parsed?.url === "string" ? parsed.url : null;
}

export async function writeVocalStemUrl(songId: string, url: string): Promise<void> {
  await storage.saveJson(`analyses/${songId}.vocal.json`, { url });
}
