import { describe, it, expect } from "vitest";
import { assertSafeHost } from "./net.js";

describe("assertSafeHost — literal IPv4", () => {
  it("blocks the IMDS endpoint", async () => {
    await expect(assertSafeHost("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /private/i
    );
  });

  it("blocks RFC1918 10.0.0.0/8", async () => {
    await expect(assertSafeHost("http://10.0.0.1/")).rejects.toThrow(/private/i);
  });

  it("blocks RFC1918 192.168.0.0/16", async () => {
    await expect(assertSafeHost("https://192.168.1.1/")).rejects.toThrow(/private/i);
  });

  it("blocks RFC1918 172.16.0.0/12 (boundary)", async () => {
    await expect(assertSafeHost("https://172.16.0.1/")).rejects.toThrow(/private/i);
    await expect(assertSafeHost("https://172.31.255.255/")).rejects.toThrow(/private/i);
  });

  it("does NOT block 172.32.0.1 (just outside RFC1918)", async () => {
    // assertSafeHost only does DNS lookup for hostnames; a literal IP outside
    // the private ranges should pass through with no network call.
    await expect(assertSafeHost("https://172.32.0.1/")).resolves.toBeUndefined();
  });

  it("blocks loopback 127.0.0.1", async () => {
    await expect(assertSafeHost("http://127.0.0.1/")).rejects.toThrow(/private/i);
  });

  it("blocks CGNAT 100.64.0.0/10", async () => {
    await expect(assertSafeHost("https://100.64.0.1/")).rejects.toThrow(/private/i);
    await expect(assertSafeHost("https://100.127.255.255/")).rejects.toThrow(/private/i);
  });

  it("allows public IPv4 (8.8.8.8)", async () => {
    await expect(assertSafeHost("https://8.8.8.8/")).resolves.toBeUndefined();
  });
});

describe("assertSafeHost — literal IPv6", () => {
  it("blocks ::1 loopback", async () => {
    await expect(assertSafeHost("http://[::1]/")).rejects.toThrow(/private/i);
  });

  it("blocks fe80::/10 link-local", async () => {
    await expect(assertSafeHost("http://[fe80::1]/")).rejects.toThrow(/private/i);
  });

  it("blocks IPv4-mapped IMDS via ::ffff:169.254.169.254", async () => {
    await expect(assertSafeHost("http://[::ffff:169.254.169.254]/")).rejects.toThrow(/private/i);
  });

  it("blocks fc00::/7 ULA", async () => {
    await expect(assertSafeHost("http://[fc00::1]/")).rejects.toThrow(/private/i);
  });
});

describe("assertSafeHost — DNS resolution (real lookups)", () => {
  it("rejects 'localhost' (resolves to 127.0.0.1 / ::1)", async () => {
    await expect(assertSafeHost("https://localhost/")).rejects.toThrow(/private/i);
  });

  it("allows a public hostname (example.com)", async () => {
    // example.com is reserved by IANA, resolves to public IPs. If this test
    // gets flaky in CI with no network, swap for a literal-IP test instead.
    await expect(assertSafeHost("https://example.com/")).resolves.toBeUndefined();
  });
});
