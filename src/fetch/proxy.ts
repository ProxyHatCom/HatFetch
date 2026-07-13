import { ProxyHat, buildProxyUsername, PROXYHAT_GATEWAY, PROXYHAT_PORT_HTTP } from "proxyhat";

/**
 * A resolved proxy specification: the full proxy URL plus metadata. The caller
 * builds a fresh dispatcher from `uri` per attempt (so rotating IPs actually rotate).
 */
export interface ProxySpec {
  /** Full proxy URL, e.g. http://user:pass@gate.proxyhat.com:8080 (for undici). */
  uri: string;
  /** Structured parts for Playwright/Patchright: server + basic-auth. */
  server: string;
  username: string;
  password: string;
  /** Human-readable label for logs / error messages. */
  label: string;
  /** True when this is the first-class ProxyHat residential path. */
  isProxyHat: boolean;
}

interface GatewayCreds {
  username: string;
  password: string;
}

/** Cache sub-user lookups per API key so we hit the ProxyHat API at most once. */
const credsCache = new Map<string, Promise<GatewayCreds>>();

/**
 * Resolve a sub-user to connect through via the official `proxyhat` SDK.
 * Selection: an explicit PROXYHAT_SUBUSER (uuid or name) if set, otherwise the
 * first active, non-suspended sub-user with remaining traffic.
 */
async function fetchSubUserCreds(apiKey: string, env: NodeJS.ProcessEnv): Promise<GatewayCreds> {
  let list;
  try {
    list = await new ProxyHat({ apiKey }).sub_users.list();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`ProxyHat API lookup failed (${reason}) — check PROXYHAT_API_KEY from your dashboard.`);
  }

  const usable = list.filter((s) => !s.suspended_at && (s.traffic_limit === 0 || s.used_traffic < s.traffic_limit));
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
    return gatewaySpec({ username: phUser, password: phPass }, env, "ProxyHat residential");
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
    return gatewaySpec(creds, env, "ProxyHat residential (via API key)");
  }

  const proxyUrl = env.PROXY_URL?.trim();
  if (proxyUrl) {
    const u = new URL(proxyUrl);
    return {
      uri: proxyUrl,
      server: `${u.protocol}//${u.host}`,
      username: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      label: "custom proxy",
      isProxyHat: false,
    };
  }

  return null;
}

/**
 * Build a ProxySpec (undici uri + Playwright parts) for the ProxyHat gateway,
 * using the official SDK's grammar builder + gateway constants (single source of truth).
 */
function gatewaySpec(creds: GatewayCreds, env: NodeJS.ProcessEnv, label: string): ProxySpec {
  const username = buildProxyUsername(creds.username, {
    country: env.PROXYHAT_COUNTRY,
    region: env.PROXYHAT_REGION,
    city: env.PROXYHAT_CITY,
    sticky: env.PROXYHAT_STICKY,
    filter: env.PROXYHAT_FILTER,
  });
  const gateway = `${PROXYHAT_GATEWAY}:${PROXYHAT_PORT_HTTP}`;
  return {
    uri: `http://${encodeURIComponent(username)}:${encodeURIComponent(creds.password)}@${gateway}`,
    server: `http://${gateway}`,
    username,
    password: creds.password,
    label,
    isProxyHat: true,
  };
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
