import { randomBytes } from "node:crypto";
import { fetch } from "undici";

/**
 * A resolved proxy specification: the full proxy URL plus metadata. The caller
 * builds a fresh dispatcher from `uri` per attempt (so rotating IPs actually rotate).
 */
export interface ProxySpec {
  /** Full proxy URL, e.g. http://user:pass@gate.proxyhat.com:8080 */
  uri: string;
  /** Human-readable label for logs / error messages. */
  label: string;
  /** True when this is the first-class ProxyHat residential path. */
  isProxyHat: boolean;
}

const PROXYHAT_GATEWAY = "gate.proxyhat.com";
const PROXYHAT_PORT = 8080;
const PROXYHAT_API_BASE = "https://api.proxyhat.com/v1";

/** Slugify a city/region value the way the ProxyHat gateway expects (spaces -> underscores). */
function slug(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Build the ProxyHat residential proxy username from its dash-delimited grammar:
 *   <base>-country-<iso>[-city-<slug>][-sid-<16hex>-ttl-<dur>][-filter-<type>]
 * Country is always present (defaults to `any`). A sticky session is added only
 * when requested; otherwise the gateway rotates the IP on every request.
 */
export function buildProxyHatUsername(
  base: string,
  opts: {
    country?: string;
    region?: string;
    city?: string;
    sticky?: string | undefined;
    filter?: string;
  } = {},
): string {
  // Fixed token order per ProxyHat's grammar: base -> country -> region -> city
  // -> [sid -> ttl] -> filter (last). See docs.proxyhat.com/connecting §6.2.
  const parts = [base.trim(), "country", (opts.country || "any").trim().toLowerCase()];

  if (opts.region && opts.region.trim().toLowerCase() !== "any") {
    parts.push("region", slug(opts.region));
  }

  if (opts.city) {
    parts.push("city", slug(opts.city));
  }

  if (opts.sticky !== undefined) {
    // A truthy PROXYHAT_STICKY enables a sticky IP. Its value (e.g. "30m", "12h")
    // sets the TTL; a bare "true"/"1"/"" falls back to the 30m default. The server
    // whitelist is {30m, 12h}; the gateway also accepts humanized client TTLs.
    const ttl = /^(true|1|yes|on)?$/i.test(opts.sticky) ? "30m" : opts.sticky.trim();
    parts.push("sid", randomBytes(8).toString("hex"), "ttl", ttl);
  }

  // Filter is appended last. Values: filter-high | filter-medium |
  // filter-high-speed-fast | filter-medium-speed-fast. "none" appends nothing.
  // Accept the value with or without the leading "filter-".
  const filter = opts.filter?.trim().toLowerCase().replace(/^filter-/, "");
  if (filter && filter !== "none") {
    parts.push("filter", filter);
  }

  return parts.join("-");
}

interface GatewayCreds {
  username: string;
  password: string;
}

/** Cache sub-user lookups per API key so we hit the ProxyHat API at most once. */
const credsCache = new Map<string, Promise<GatewayCreds>>();

/**
 * Fetch the account's sub-users via the ProxyHat management API and pick one to
 * connect through. Selection: an explicit PROXYHAT_SUBUSER (uuid or name) if set,
 * otherwise the first active, non-suspended sub-user with remaining traffic.
 */
async function fetchSubUserCreds(apiKey: string, env: NodeJS.ProcessEnv): Promise<GatewayCreds> {
  const res = await fetch(`${PROXYHAT_API_BASE}/sub-users`, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(
      `ProxyHat API returned HTTP ${res.status} for /sub-users — check PROXYHAT_API_KEY (get it from your ProxyHat dashboard).`,
    );
  }

  const body = (await res.json()) as { payload?: SubUser[] };
  const list = Array.isArray(body.payload) ? body.payload : [];

  const hasTraffic = (s: SubUser) => s.traffic_limit === 0 || (s.used_traffic ?? 0) < s.traffic_limit;
  const usable = list.filter((s) => !s.suspended_at && hasTraffic(s));

  const want = env.PROXYHAT_SUBUSER?.trim();
  const chosen = want ? list.find((s) => s.uuid === want || s.name === want) : usable[0];

  if (!chosen?.proxy_username || !chosen?.proxy_password) {
    throw new Error(
      want
        ? `No sub-user matched PROXYHAT_SUBUSER="${want}" (or it has no proxy credentials).`
        : "No usable ProxyHat sub-user found (all suspended or out of traffic). Top up or unsuspend one, or set PROXYHAT_SUBUSER.",
    );
  }
  return { username: chosen.proxy_username, password: chosen.proxy_password };
}

interface SubUser {
  uuid?: string;
  name?: string;
  proxy_username?: string;
  proxy_password?: string;
  used_traffic?: number;
  traffic_limit: number;
  suspended_at?: string | null;
}

/** Build the full gateway proxy URL from base credentials + targeting env vars. */
function gatewayUri(creds: GatewayCreds, env: NodeJS.ProcessEnv): string {
  const username = buildProxyHatUsername(creds.username, {
    country: env.PROXYHAT_COUNTRY,
    region: env.PROXYHAT_REGION,
    city: env.PROXYHAT_CITY,
    sticky: env.PROXYHAT_STICKY,
    filter: env.PROXYHAT_FILTER,
  });
  return `http://${encodeURIComponent(username)}:${encodeURIComponent(creds.password)}@${PROXYHAT_GATEWAY}:${PROXYHAT_PORT}`;
}

/**
 * Resolve a proxy from the environment.
 *
 * Precedence:
 *   1. PROXYHAT_USERNAME + PROXYHAT_PASSWORD -> ProxyHat gateway (explicit creds).
 *   2. PROXYHAT_API_KEY -> look up a sub-user via the API, then the gateway.
 *   3. PROXY_URL -> any generic http(s) proxy.
 *   4. Nothing set -> null (requests go direct).
 *
 * Async because path 2 calls the ProxyHat API (cached per key). Throws a helpful
 * Error if an API key is set but no usable sub-user can be resolved.
 */
export async function resolveProxySpec(env: NodeJS.ProcessEnv = process.env): Promise<ProxySpec | null> {
  const phUser = env.PROXYHAT_USERNAME?.trim();
  const phPass = env.PROXYHAT_PASSWORD?.trim();
  if (phUser && phPass) {
    return { uri: gatewayUri({ username: phUser, password: phPass }, env), label: "ProxyHat residential", isProxyHat: true };
  }

  const apiKey = env.PROXYHAT_API_KEY?.trim();
  if (apiKey) {
    let pending = credsCache.get(apiKey);
    if (!pending) {
      pending = fetchSubUserCreds(apiKey, env);
      // Don't cache failures — let the next attempt retry.
      pending.catch(() => credsCache.delete(apiKey));
      credsCache.set(apiKey, pending);
    }
    const creds = await pending;
    return { uri: gatewayUri(creds, env), label: "ProxyHat residential (via API key)", isProxyHat: true };
  }

  const proxyUrl = env.PROXY_URL?.trim();
  if (proxyUrl) {
    return { uri: proxyUrl, label: "custom proxy", isProxyHat: false };
  }

  return null;
}

/** True when at least one proxy source is configured (sync; does not call the API). */
export function hasProxy(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    (env.PROXYHAT_USERNAME?.trim() && env.PROXYHAT_PASSWORD?.trim()) ||
      env.PROXYHAT_API_KEY?.trim() ||
      env.PROXY_URL?.trim(),
  );
}

/** Test-only: clear the sub-user credential cache. */
export function _clearCredsCache(): void {
  credsCache.clear();
}
