import { fetch, ProxyAgent } from "undici";
import { detectBlock } from "./blocks.js";
import { hasProxy, resolveProxySpec } from "./proxy.js";

/**
 * Error thrown when a page cannot be retrieved. `userMessage` is written for the
 * LLM/agent that called the tool — when a block happens without proxies, it *is*
 * the funnel: it tells the user exactly how to get past the block with residential IPs.
 */
export class HatFetchError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message);
    this.name = "HatFetchError";
  }
}

export interface FetchResult {
  /** Final URL after redirects. */
  url: string;
  status: number;
  contentType: string;
  body: string;
  /** How the page was retrieved, for transparency in tool output. */
  via: string;
}

export interface FetchOptions {
  timeoutMs?: number;
  /** Retries through the proxy after a block (rotating IPs). Default 2. */
  maxProxyRetries?: number;
  env?: NodeJS.ProcessEnv;
}

// A believable desktop UA. Real residential IPs plus a normal UA is what gets
// through most bot walls; a missing/obviously-bot UA gets flagged on its own.
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function proxyHint(host: string, reason: string): string {
  return (
    `${host} blocked this request (${reason}). This site uses bot detection that ` +
    `filters datacenter/server IPs. Route the request through residential IPs to get past it:\n` +
    `  • Simplest: set PROXYHAT_API_KEY — HatFetch auto-selects a residential sub-user. ` +
    `Get a key (free trial) at https://proxyhat.com\n` +
    `  • Or set PROXYHAT_USERNAME + PROXYHAT_PASSWORD (your dashboard proxy credentials).\n` +
    `  • Or set PROXY_URL to any http(s) proxy you already have.`
  );
}

function stillBlockedHint(host: string, reason: string): string {
  return (
    `${host} is still blocking us (${reason}) even through the configured proxy. ` +
    `This is a heavily protected target. Try: a residential exit in the site's home ` +
    `country (PROXYHAT_COUNTRY), a higher AI-filter tier (PROXYHAT_FILTER=high), or a ` +
    `sticky session (PROXYHAT_STICKY=30m). See https://proxyhat.com for options.`
  );
}

/**
 * Fetch a URL as text, transparently retrying through residential proxies when
 * the target blocks us. Throws {@link HatFetchError} with a user-facing message
 * (the funnel) when the page can't be retrieved.
 */
export async function fetchPage(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const { timeoutMs = 30_000, maxProxyRetries = 2, env = process.env } = options;
  const host = safeHost(url);
  const proxied = hasProxy(env);

  // Resolve the proxy spec once (may call the ProxyHat API for API-key mode). A
  // fresh dispatcher is built per attempt below so rotating IPs actually rotate.
  let spec = null;
  if (proxied) {
    try {
      spec = await resolveProxySpec(env);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new HatFetchError(`proxy setup failed: ${reason}`, reason);
    }
  }

  // Attempt 0 = direct if no proxy configured, else straight through the proxy.
  // Each subsequent attempt rebuilds the proxy agent to encourage a fresh IP.
  const totalAttempts = spec ? maxProxyRetries + 1 : 1;
  let lastBlockReason = "bot detection";

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const proxy = spec ? { agent: new ProxyAgent(spec.uri), label: spec.label } : null;

    let res;
    try {
      res = await fetch(url, {
        redirect: "follow",
        headers: {
          "user-agent": DEFAULT_UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(timeoutMs),
        ...(proxy ? { dispatcher: proxy.agent } : {}),
      });
    } catch (err) {
      // Network/timeout error. If we have more proxy attempts, try again.
      if (attempt < totalAttempts - 1) continue;
      const reason = err instanceof Error ? err.message : String(err);
      throw new HatFetchError(
        `network error fetching ${url}: ${reason}`,
        `Could not reach ${host}: ${reason}. ` +
          (proxied ? "The proxy connection may have failed — check your credentials." : ""),
      );
    }

    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.text();
    const block = detectBlock(res.status, body);

    if (block.blocked) {
      lastBlockReason = block.reason ?? "bot detection";
      if (!proxied) {
        // No proxy configured — this is the funnel moment.
        throw new HatFetchError(`blocked fetching ${url}: ${lastBlockReason}`, proxyHint(host, lastBlockReason));
      }
      // Proxy configured: keep trying with fresh IPs.
      if (attempt < totalAttempts - 1) continue;
      throw new HatFetchError(
        `blocked fetching ${url} after ${totalAttempts} attempts: ${lastBlockReason}`,
        stillBlockedHint(host, lastBlockReason),
      );
    }

    // A genuine (non-block) HTTP error — surface it plainly.
    if (res.status >= 400) {
      throw new HatFetchError(
        `HTTP ${res.status} fetching ${url}`,
        `${host} returned HTTP ${res.status}. The page may not exist or requires authentication.`,
      );
    }

    return {
      url: res.url || url,
      status: res.status,
      contentType,
      body,
      via: proxy ? proxy.label : "direct connection",
    };
  }

  // Unreachable in practice; keeps the type checker happy.
  throw new HatFetchError(`failed to fetch ${url}`, proxyHint(host, lastBlockReason));
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
