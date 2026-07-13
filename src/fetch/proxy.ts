import { randomBytes } from "node:crypto";
import { ProxyAgent } from "undici";

/**
 * A resolved proxy configuration, ready to be handed to `fetch` as a dispatcher.
 */
export interface ProxyConfig {
  /** undici dispatcher that routes requests through the proxy. */
  agent: ProxyAgent;
  /** Human-readable label for logs / error messages. */
  label: string;
  /** True when this is the first-class ProxyHat residential path. */
  isProxyHat: boolean;
}

const PROXYHAT_GATEWAY = "gate.proxyhat.com";
const PROXYHAT_PORT = 8080;

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
    city?: string;
    sticky?: string | undefined;
    filter?: string;
  } = {},
): string {
  const parts = [base.trim(), "country", (opts.country || "any").trim().toLowerCase()];

  if (opts.city) {
    parts.push("city", slug(opts.city));
  }

  if (opts.sticky !== undefined) {
    // A truthy PROXYHAT_STICKY enables a sticky IP. Its value (e.g. "30m", "12h")
    // sets the TTL; a bare "true"/"1"/"" falls back to the 30m default.
    const ttl = /^(true|1|yes|on)?$/i.test(opts.sticky) ? "30m" : opts.sticky.trim();
    parts.push("sid", randomBytes(8).toString("hex"), "ttl", ttl);
  }

  if (opts.filter) {
    parts.push("filter", opts.filter.trim().toLowerCase());
  }

  return parts.join("-");
}

/**
 * Resolve a proxy from the environment.
 *
 * Precedence:
 *   1. PROXYHAT_USERNAME + PROXYHAT_PASSWORD -> ProxyHat residential gateway.
 *   2. PROXY_URL -> any generic http(s) proxy.
 *   3. Nothing set -> null (requests go direct).
 */
export function buildProxy(env: NodeJS.ProcessEnv = process.env): ProxyConfig | null {
  const phUser = env.PROXYHAT_USERNAME?.trim();
  const phPass = env.PROXYHAT_PASSWORD?.trim();

  if (phUser && phPass) {
    const username = buildProxyHatUsername(phUser, {
      country: env.PROXYHAT_COUNTRY,
      city: env.PROXYHAT_CITY,
      sticky: env.PROXYHAT_STICKY,
      filter: env.PROXYHAT_FILTER,
    });
    const uri = `http://${encodeURIComponent(username)}:${encodeURIComponent(
      phPass,
    )}@${PROXYHAT_GATEWAY}:${PROXYHAT_PORT}`;
    return { agent: new ProxyAgent(uri), label: "ProxyHat residential", isProxyHat: true };
  }

  const proxyUrl = env.PROXY_URL?.trim();
  if (proxyUrl) {
    return { agent: new ProxyAgent(proxyUrl), label: "custom proxy", isProxyHat: false };
  }

  return null;
}

/** True when at least one proxy source is configured. */
export function hasProxy(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.PROXYHAT_USERNAME?.trim() && env.PROXYHAT_PASSWORD?.trim()) || env.PROXY_URL?.trim());
}
