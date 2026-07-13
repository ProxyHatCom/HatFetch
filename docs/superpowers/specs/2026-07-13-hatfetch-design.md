# HatFetch — AI web-access MCP server by ProxyHat

**Status:** Design approved 2026-07-13
**Repo:** `ProxyHatCom/HatFetch` · npm `hatfetch` · MIT

## Purpose

A Model Context Protocol (MCP) server that gives any LLM agent (Claude Desktop,
Claude Code, Cursor, etc.) the ability to read any website — including sites that
block bots — and get back clean, LLM-ready Markdown.

This is a **hero open-source tool** for ProxyHat's GitHub profile. Its growth loop:
developers adopt it because it solves a real problem (agents need web access);
when a target site blocks them, the tool's own failure mode teaches them they need
residential proxies, with ProxyHat as the one-line fix. The proxy sells itself
through the tool's failure modes — never a paywall.

### Why this over the alternatives

The org's current repos are all "helper" repos (SDKs + commodity utilities) with no
intrinsic pull. This is a standalone tool with its own demand, in the highest-traffic
2026 category ("web access for AI agents" — cf. Firecrawl 131k, Crawl4AI 68k stars),
following the CloakBrowser open-core PLG model (28k stars).

## Non-goals (MVP)

- **No headless / JS rendering** (Playwright). HTTP-only keeps the *proxy-bypass*
  story central and avoids competing with CloakBrowser's browser-automation turf.
  Deferred to v2 as an optional mode.
- **No `search` tool.** Deferred to v2. It adds a dependency and dilutes the
  "get any URL past blocks" core story.
- **No paid gating in the code.** The tool is fully usable with the user's own
  proxies or no proxy at all.

## Tool surface (MVP)

### `scrape`
- **Params:** `url: string` (required), `onlyMainContent?: boolean` (default true).
- **Returns:** clean Markdown of the page.
- **Behavior:** fetch → detect block → (auto-retry via proxy if configured) →
  extract main content (Readability) → convert to Markdown (Turndown).

### `crawl`
- **Params:** `url: string` (required), `maxDepth?: number` (default 2),
  `maxPages?: number` (default 20), `sameDomain?: boolean` (default true).
- **Returns:** array of `{ url, markdown }`.
- **Behavior:** BFS from the seed URL, honoring caps, reusing the `scrape` pipeline
  per page. Deduplicates URLs; skips non-HTML and off-domain links when `sameDomain`.

## Architecture

TypeScript, Node ≥ 18, ESM. Stdio MCP transport.

```
hatfetch/
  src/
    index.ts          # MCP server entry: registers scrape + crawl tools
    tools/
      scrape.ts       # scrape tool handler + input schema
      crawl.ts        # crawl tool handler + input schema (BFS)
    fetch/
      client.ts       # fetch with proxy dispatcher + block-aware retry
      proxy.ts        # build undici ProxyAgent from env (ProxyHat or generic)
      blocks.ts       # detect blocks (status + body signatures)
    html/
      markdown.ts     # Readability main-content + Turndown HTML->Markdown
  test/               # vitest, mocked fetch
  README.md           # CloakBrowser-style: quickstart -> comparison -> docs
  package.json
  tsconfig.json
  LICENSE             # MIT
  .github/workflows/ci.yml
```

### Dependencies (minimal, deliberate)
- `@modelcontextprotocol/sdk` — MCP server.
- `undici` — `ProxyAgent` dispatcher for proxy support with native fetch.
- `@mozilla/readability` + `linkedom` (or `jsdom`) — main-content extraction.
- `turndown` — HTML → Markdown.
- Dev: `typescript`, `vitest`, `tsx`, `@types/node`.

## Fetch layer & the funnel

### Proxy config (env vars)
First-class ProxyHat path — builds the real residential gateway URL
`http://<username>:<password>@gate.proxyhat.com:8080`, where the username encodes
targeting per ProxyHat's grammar
`<base>-country-<iso>[-city-<slug>][-sid-<16hex>-ttl-<dur>][-filter-<type>]`:
- `PROXYHAT_USERNAME` — sub-user `proxy_username` (base, e.g. `ph-8f2a1c`). Required to enable.
- `PROXYHAT_PASSWORD` — sub-user `proxy_password`. Required to enable.
- `PROXYHAT_COUNTRY` — ISO code or `any` (default `any`).
- `PROXYHAT_CITY` — optional city slug (underscores for spaces).
- `PROXYHAT_STICKY` — optional; when set, generate a 16-hex `sid` +
  `ttl` (value like `30m`/`12h`, default `30m`) for a sticky IP. Omitted → rotating
  (fresh IP per request), which is the default and ideal for block-retry.
- `PROXYHAT_FILTER` — optional AI-filter tier: `medium` (ProxyHat default), `high`,
  `high-speed-fast`. Omitted → ProxyHat default.

Generic escape hatch:
- `PROXY_URL` → any `http(s)://user:pass@host:port` proxy.

Precedence: `PROXYHAT_USERNAME`+`PROXYHAT_PASSWORD` wins over `PROXY_URL`; if neither
is set, requests go direct.

### Block detection (`blocks.ts`)
Flag a response as blocked when:
- HTTP status ∈ {403, 429, 503}, **or**
- body contains known challenge signatures (Cloudflare `cf-mitigated` / "Just a
  moment...", Turnstile, `captcha`, PerimeterX, Datadome markers).

### Retry logic (`client.ts`)
1. First attempt: direct, or via configured proxy.
2. On block **with** a proxy configured: retry up to N times (default 2) through the
   proxy (rotating session where ProxyHat supports it).
3. On block **with no proxy configured**: do NOT silently fail. Return a structured,
   honest error whose message is the funnel:
   > `example.com` blocked this request (403, bot detection). Route through
   > residential IPs to get past it — set `PROXYHAT_USERNAME` + `PROXYHAT_PASSWORD`
   > (free trial at proxyhat.com) or your own `PROXY_URL`.
4. On block **with** proxy configured but still blocked after retries: return an
   error noting the site is heavily protected and suggesting a different country /
   sticky session (still ProxyHat-flavored, still honest).

## Error handling
- Network/DNS errors → structured error with the underlying reason.
- Non-HTML content types → return a note + raw text when short, else a size note.
- Timeouts (default 30s per request) → structured timeout error.
- All tool errors are returned as MCP tool errors, never thrown uncaught.

## Testing (vitest, fetch mocked)
- `blocks.ts`: each status + each body signature classified correctly; clean pages not flagged.
- `proxy.ts`: env → correct proxy URL; ProxyHat precedence over `PROXY_URL`; none → no agent.
- `markdown.ts`: HTML fixture → expected Markdown; main-content extraction strips nav/footer.
- `client.ts`: block → retry-through-proxy path; block + no proxy → funnel message; success path.
- `crawl.ts`: respects `maxPages`/`maxDepth`/`sameDomain`; dedupes URLs.

## README structure (CloakBrowser model)
1. Hero line + one GIF/screenshot of an agent scraping a blocked site.
2. 3-line quickstart (add to Claude/Cursor config).
3. "Getting blocked?" → the ProxyHat funnel, one config line.
4. Comparison table (HatFetch vs raw fetch vs Firecrawl-style hosted).
5. Tool reference (scrape, crawl).
6. Config (env vars).
7. Roadmap (v2: JS rendering, search), license.

## Distribution (post-build, not code)
- Publish `hatfetch` to npm.
- Launch: Hacker News + r/webscraping + r/programming; honest technical framing.
- Submit to `awesome-mcp` / `awesome-web-scraping` lists and GitHub topics.
