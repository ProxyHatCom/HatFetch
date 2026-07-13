/**
 * SSRF guard. HatFetch hands a URL-fetching tool to an autonomous agent, so a
 * prompt-injected page could try to make it reach internal services, cloud
 * metadata, or loopback. We block obviously-internal targets up front.
 *
 * Best-effort: covers scheme, localhost, and IP literals in private/loopback/
 * link-local ranges (incl. 169.254.169.254 metadata). It does NOT resolve DNS,
 * so a hostname that resolves to a private IP (DNS rebinding) is not caught here.
 */

function ipv4ToParts(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

function isPrivateIPv4(parts: number[]): boolean {
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7 ULA
  if (h.startsWith("fe80")) return true; // link-local
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h); // IPv4-mapped
  if (mapped) {
    const parts = ipv4ToParts(mapped[1]!);
    return parts ? isPrivateIPv4(parts) : false;
  }
  return false;
}

/**
 * Validate a URL for outbound fetching. Returns the parsed URL if allowed;
 * throws with a clear reason otherwise.
 */
export function assertFetchable(rawUrl: string): URL {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Refusing to fetch non-http(s) URL (${u.protocol}//…).`);
  }

  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error(`Refusing to fetch internal address "${host}".`);
  }
  const v4 = ipv4ToParts(host);
  if (v4 && isPrivateIPv4(v4)) {
    throw new Error(`Refusing to fetch private/internal IP ${host}.`);
  }
  if (host.includes(":") && isPrivateIPv6(host)) {
    throw new Error(`Refusing to fetch private/internal IP ${host}.`);
  }
  return u;
}
