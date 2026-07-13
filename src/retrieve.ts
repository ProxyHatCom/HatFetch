import { renderPage } from "./browser/render.js";
import { detectBlock } from "./fetch/blocks.js";
import { fetchPage, HatFetchError } from "./fetch/client.js";
import { hasProxy, resolveProxySpec } from "./fetch/proxy.js";
import { assertFetchable } from "./fetch/ssrf.js";
import { htmlToMarkdown, looksLikeEmptyShell } from "./html/markdown.js";

export type RenderMode = "auto" | "http" | "browser";

export interface RetrieveOptions {
  render?: RenderMode;
  onlyMainContent?: boolean;
  screenshot?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface RetrieveResult {
  url: string;
  title: string | null;
  markdown: string;
  links: string[];
  /** How it was retrieved, e.g. "direct connection", "ProxyHat residential + browser". */
  via: string;
  status: number;
  screenshot?: Buffer;
}

/**
 * Retrieve a URL as clean Markdown, escalating from a cheap HTTP fetch to a real
 * (stealth) browser when needed:
 *   - render:"http"    → HTTP only.
 *   - render:"browser" → browser only (JS rendering + fingerprint).
 *   - render:"auto"    → HTTP first; escalate to the browser if the page is an
 *                        empty SPA shell, or if it was blocked *and* a proxy is
 *                        configured (so the browser adds fingerprint to the IP).
 * A screenshot request always uses the browser.
 */
export async function retrieve(url: string, options: RetrieveOptions = {}): Promise<RetrieveResult> {
  const { render = "auto", onlyMainContent = true, screenshot = false, env = process.env } = options;
  assertFetchable(url); // SSRF guard (also enforced in fetchPage).

  if (render === "browser" || screenshot) {
    return viaBrowser(url, { onlyMainContent, screenshot, env });
  }

  try {
    const res = await fetchPage(url, { env });
    const isHtml = res.contentType.includes("html") || res.contentType === "";
    if (!isHtml) {
      return { url: res.url, title: null, markdown: res.body, links: [], via: res.via, status: res.status };
    }

    const extracted = htmlToMarkdown(res.body, res.url, onlyMainContent);
    if (render === "auto" && looksLikeEmptyShell(extracted.markdown, res.body)) {
      // Looks client-rendered — a browser will actually get the content.
      return viaBrowser(url, { onlyMainContent, screenshot: false, env, reason: "spa" });
    }
    return { url: res.url, ...extracted, via: res.via, status: res.status };
  } catch (err) {
    // Escalate to the browser when HTTP failed in a way a real browser can fix:
    //  - an anti-bot block (pair a fresh residential IP with a real fingerprint), or
    //  - a network error (anti-bot layers often RST the undici TLS handshake, which
    //    surfaces as a network failure rather than a 403).
    // A genuine 404/500 (kind "http") is NOT escalated — the browser can't fix it.
    if (render === "auto" && err instanceof HatFetchError && (err.kind === "network" || (err.blocked && hasProxy(env)))) {
      return viaBrowser(url, { onlyMainContent, screenshot: false, env, reason: "block" });
    }
    throw err;
  }
}

async function viaBrowser(
  url: string,
  opts: { onlyMainContent: boolean; screenshot: boolean; env: NodeJS.ProcessEnv; reason?: "spa" | "block" },
): Promise<RetrieveResult> {
  const { onlyMainContent, screenshot, env, reason } = opts;
  const proxy = hasProxy(env) ? await resolveProxySpec(env) : null;

  let r;
  try {
    r = await renderPage(url, { proxy, screenshot });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HatFetchError(`browser render failed for ${url}: ${msg}`, `Could not render ${safeHost(url)}: ${msg}`);
  }

  const extracted = htmlToMarkdown(r.html, r.finalUrl, onlyMainContent);
  const block = detectBlock(r.status, r.html);

  // If even the browser+proxy landed on a challenge/block page, be honest instead
  // of returning the block page's text as if it were real content.
  if (block.blocked) {
    throw new HatFetchError(
      `still blocked in browser mode for ${url}: ${block.reason}`,
      `${safeHost(url)} is behind advanced bot protection (${block.reason}) that resisted even a real ` +
        `browser through residential IPs. This target may need an interactive CAPTCHA solver. Try a ` +
        `different PROXYHAT_COUNTRY or PROXYHAT_FILTER=high. See https://proxyhat.com`,
      "block",
    );
  }

  const label = proxy ? `${proxy.label} + browser` : "browser";
  const via = reason === "spa" ? `${label} (auto: SPA)` : reason === "block" ? `${label} (auto: unblock)` : label;
  return {
    url: r.finalUrl,
    ...extracted,
    via,
    status: r.status,
    ...(r.screenshot ? { screenshot: r.screenshot } : {}),
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
