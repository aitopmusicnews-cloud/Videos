import { createHash, createHmac } from "node:crypto";
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
// container disk. RENDERS is still needed transiently in s3 mode (ffmpeg
// writes the mp4 there before saveRender ships it), but renderTimeline already
// creates that directory on every call.
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

export interface StorageBackend {
  saveUpload(
    buf: Buffer,
    originalName: string,
    contentType?: string
  ): Promise<{ id: string; publicUrl: string }>;
  saveRender(localPath: string, key: string, contentType?: string): Promise<{ publicUrl: string }>;
  saveJson(key: string, data: unknown): Promise<void>;
  loadJson<T>(key: string): Promise<T | null>;
  listJson(prefix: string): Promise<string[]>;
  deleteJson(key: string): Promise<boolean>;
  listFiles(prefix: string): Promise<FileEntry[]>;
  /** Refresh an owned media URL so private S3 objects remain browser-playable. */
  playableUrl(rawUrl: string): Promise<string>;
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

  async playableUrl(rawUrl: string): Promise<string> {
    return rawUrl;
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

const PRESIGNED_URL_TTL_SECONDS = 24 * 60 * 60;

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function canonicalS3Path(key: string): string {
  return `/${key.split("/").map(rfc3986).join("/")}`;
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

class S3Backend implements StorageBackend {
  private client: S3Client;
  private bucket: string;
  private region: string;

  constructor() {
    this.bucket = config.S3_BUCKET!;
    this.region = config.S3_REGION!;
    this.client = new S3Client({ region: this.region });
  }

  private async url(key: string): Promise<string> {
    return this.signGetUrl(key);
  }

  private signGetUrl(key: string): string {
    const accessKeyId = config.AWS_ACCESS_KEY_ID!;
    const secretAccessKey = config.AWS_SECRET_ACCESS_KEY!;
    const sessionToken = config.AWS_SESSION_TOKEN;
    const host = `${this.bucket}.s3.${this.region}.amazonaws.com`;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;

    const params: Array<[string, string]> = [
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      ["X-Amz-Credential", `${accessKeyId}/${credentialScope}`],
      ["X-Amz-Date", amzDate],
      ["X-Amz-Expires", String(PRESIGNED_URL_TTL_SECONDS)],
      ["X-Amz-SignedHeaders", "host"],
    ];
    if (sessionToken) params.push(["X-Amz-Security-Token", sessionToken]);

    params.sort(([aKey, aValue], [bKey, bValue]) =>
      aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey)
    );
    const canonicalQuery = params
      .map(([name, value]) => `${rfc3986(name)}=${rfc3986(value)}`)
      .join("&");
    const canonicalPath = canonicalS3Path(key);
    const canonicalRequest = [
      "GET",
      canonicalPath,
      canonicalQuery,
      `host:${host}\n`,
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256(canonicalRequest),
    ].join("\n");

    const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
    const regionKey = hmac(dateKey, this.region);
    const serviceKey = hmac(regionKey, "s3");
    const signingKey = hmac(serviceKey, "aws4_request");
    const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

    return `https://${host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  private keyFromUrl(rawUrl: string): string | null {
    const cleaned = rawUrl.trim();
    if (!cleaned) return null;
    if (cleaned.startsWith(`s3://${this.bucket}/`)) {
      return decodeURIComponent(cleaned.slice(`s3://${this.bucket}/`.length));
    }
    if (cleaned.startsWith("/media/")) {
      return decodeURIComponent(cleaned.slice("/media/".length));
    }

    let parsed: URL;
    try {
      parsed = new URL(cleaned);
    } catch {
      return null;
    }

    const path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    const virtualHosts = new Set([
      `${this.bucket}.s3.${this.region}.amazonaws.com`,
      `${this.bucket}.s3.amazonaws.com`,
    ]);
    if (virtualHosts.has(parsed.hostname)) return path;

    if (parsed.hostname === `s3.${this.region}.amazonaws.com` || parsed.hostname === "s3.amazonaws.com") {
      const prefix = `${this.bucket}/`;
      return path.startsWith(prefix) ? path.slice(prefix.length) : null;
    }

    if (config.S3_PUBLIC_URL_BASE) {
      try {
        const base = new URL(config.S3_PUBLIC_URL_BASE);
        if (base.origin === parsed.origin) {
          const basePath = base.pathname.replace(/^\/+|\/+$/g, "");
          if (!basePath) return path;
          return path.startsWith(`${basePath}/`) ? path.slice(basePath.length + 1) : null;
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  async playableUrl(rawUrl: string): Promise<string> {
    const key = this.keyFromUrl(rawUrl);
    return key ? this.url(key) : rawUrl;
  }

  async saveUpload(buf: Buffer, originalName: string, contentType?: string) {
    const id = hashBuffer(buf);
    const ext = extname(originalName) || ".bin";
    const key = `uploads/${id}${ext}`;

    const existing = await this.head(key);
    if (!existing) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buf,
          ContentType: contentType ?? mimeType(ext),
          CacheControl: "private, max-age=3600",
        })
      );
    }
    return { id, publicUrl: await this.url(key) };
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
        CacheControl: "private, max-age=3600",
      })
    );
    return { publicUrl: await this.url(objectKey) };
  }

  async saveJson(key: string, data: unknown): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(data),
        ContentType: "application/json",
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
    if (!(await this.head(key))) return false;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    return true;
  }

  async listFiles(prefix: string): Promise<FileEntry[]> {
    const all = await this.listAll(prefix);
    return Promise.all(
      all
        .filter((o) => o.Key)
        .map(async (o) => ({
          key: o.Key!,
          publicUrl: await this.url(o.Key!),
          size: o.Size ?? 0,
          modifiedAt: o.LastModified?.toISOString() ?? new Date(0).toISOString(),
        }))
    );
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

export async function saveUpload(buf: Buffer, originalName: string, contentType?: string) {
  return storage.saveUpload(buf, originalName, contentType);
}

/** Return a fresh browser-playable URL for local or private-S3 media. */
export async function playableUrl(rawUrl: string): Promise<string> {
  return storage.playableUrl(rawUrl);
}

// --- Analysis cache ------------------------------------------------------

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
  return typeof parsed?.url === "string" ? storage.playableUrl(parsed.url) : null;
}

export async function writeVocalStemUrl(songId: string, url: string): Promise<void> {
  await storage.saveJson(`analyses/${songId}.vocal.json`, { url });
}
