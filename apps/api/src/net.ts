import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard. Throws when `url`'s host resolves to a private / loopback /
 * link-local address. Apply before any code path that dials an arbitrary
 * client-supplied URL (rehost fetches, ffmpeg `-i http://...`, etc.).
 *
 * Why: inside Fargate, `169.254.169.254` exposes the task IAM creds (IMDS).
 * Other private ranges might expose internal services. We refuse them
 * pre-flight so an attacker can't pivot via our server.
 *
 * Caveats: we don't pin the resolved IP into the subsequent fetch/ffmpeg
 * call, so this is best-effort against DNS rebinding (TOCTOU). Good enough
 * for the hackathon threat model.
 */
export async function assertSafeHost(url: string): Promise<void> {
  const u = new URL(url);
  // IPv6 hostnames come back wrapped in brackets (e.g. "[::1]") — strip
  // them so `isIP` can recognize the literal form, otherwise we'd fall
  // through to DNS lookup with an invalid hostname.
  const host = u.hostname.startsWith("[") && u.hostname.endsWith("]")
    ? u.hostname.slice(1, -1)
    : u.hostname;
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error(`refusing to use private IP ${host}`);
    return;
  }
  const addrs = await lookup(host, { all: true });
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new Error(`refusing to use ${host} (resolves to private IP ${a.address})`);
    }
  }
}

function isPrivateIp(addr: string): boolean {
  const v = isIP(addr);
  if (v === 4) return isPrivateIpv4(addr);
  if (v === 6) return isPrivateIpv6(addr);
  return true;
}

function isPrivateIpv4(addr: string): boolean {
  const parts = addr.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("::ffff:")) {
    const rest = lower.slice(7);
    // Text form: ::ffff:a.b.c.d
    if (isIP(rest) === 4) return isPrivateIpv4(rest);
    // Normalized hex form: ::ffff:HHHH:HHHH (Node's URL parser produces this)
    const m = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (m) {
      const hi = parseInt(m[1]!, 16);
      const lo = parseInt(m[2]!, 16);
      const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateIpv4(v4);
    }
  }
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  if (/^f[cd][0-9a-f][0-9a-f]:/.test(lower)) return true;
  return false;
}

/** Stream a `fetch` response body into a Buffer, refusing past `maxBytes`. */
export async function readCappedBody(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    throw new Error(`response too large: ${declared} bytes (cap ${maxBytes})`);
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(`response exceeded cap of ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks);
}
