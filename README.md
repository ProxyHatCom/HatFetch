<div align="center">

# 🎩 HatFetch

**Give any LLM agent the power to read the modern web — JavaScript sites and most bot-protected pages.**

Clean Markdown out. Renders JS, rotates residential IPs, escalates to a real stealth browser only when needed.

[![npm](https://img.shields.io/npm/v/hatfetch)](https://www.npmjs.com/package/hatfetch)
[![license](https://img.shields.io/npm/l/hatfetch)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-000)](https://modelcontextprotocol.io)

</div>

---

HatFetch is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude, Cursor, and any MCP client the tools `scrape`, `crawl`, and `screenshot` — turning web pages into clean, LLM-ready Markdown.

The difference from a plain `fetch`: HatFetch **escalates automatically**. It starts with a fast HTTP fetch; if the page is a JavaScript app that renders client-side, or it gets blocked by bot detection, HatFetch transparently escalates to a **real stealth browser** ([Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)) running through **residential proxies**. Your agent stops getting empty shells and `Access Denied`, and starts getting content.

### What it does and doesn't do (honest version)

| Target | Result |
|---|---|
| Server-rendered sites (news, docs, blogs, forums, most catalogs) | ✅ Fast HTTP path |
| JavaScript / SPA sites (React, Vue, client-rendered) | ✅ Auto-escalates to the browser and renders |
| Geo-restricted content | ✅ Exit from any of 148+ countries |
| Sites that block datacenter IPs / rate-limit by IP | ✅ Rotating residential IPs |
| Many Cloudflare / anti-bot sites | ✅ Browser + residential fingerprint passes a large share |
| The hardest anti-bot (aggressive Cloudflare, DataDome, PerimeterX) | ⚠️ Sometimes blocked — HatFetch tells you honestly instead of returning a CAPTCHA page as "content" |
| CAPTCHA-gated / login-required flows | ❌ Out of scope (needs an interactive solver) |

No tool passes 100% of anti-bot in 2026 — anyone claiming otherwise is selling something. HatFetch gets you the calm-to-medium web reliably and a good share of the hard web, and is honest about the rest.

## Quick start

Add HatFetch to your MCP client — no install step, `npx` handles it:

```jsonc
// Claude Desktop: claude_desktop_config.json  ·  Cursor: ~/.cursor/mcp.json
{
  "mcpServers": {
    "hatfetch": {
      "command": "npx",
      "args": ["-y", "hatfetch"]
    }
  }
}
```

For **Claude Code**:

```bash
claude mcp add hatfetch -- npx -y hatfetch
```

That's it. Ask your agent to *"read https://example.com and summarize it"* and it will use the `scrape` tool.

## Getting blocked? 🚧

Out of the box HatFetch fetches directly from your machine's IP. That's fine for open sites — but most valuable pages sit behind bot detection that blocks datacenter and server IPs on sight. When that happens, HatFetch tells your agent exactly why, and how to fix it in one step: **route through residential IPs.**

```jsonc
{
  "mcpServers": {
    "hatfetch": {
      "command": "npx",
      "args": ["-y", "hatfetch"],
      "env": {
        "PROXYHAT_API_KEY": "your-proxyhat-api-key"
      }
    }
  }
}
```

That's the whole setup. Drop in your **API key** and HatFetch automatically looks up an active residential sub-user on your account, connects through the gateway, and rotates a fresh IP on every request — retrying automatically when a site pushes back. Get a key (free trial) at [**proxyhat.com**](https://proxyhat.com): 50M+ residential & mobile IPs across 148+ countries.

<details>
<summary>Other ways to connect</summary>

- **Explicit gateway credentials** — skip the API lookup and use a specific sub-user's proxy login:
  ```json
  { "env": { "PROXYHAT_USERNAME": "your-proxy-username", "PROXYHAT_PASSWORD": "your-proxy-password" } }
  ```
- **Pick a specific sub-user** while still using the API key: add `"PROXYHAT_SUBUSER": "<uuid or name>"`.
- **Bring your own proxy** — any HTTP(S) proxy: `"PROXY_URL": "http://user:pass@host:port"`.

</details>

## Tools

### `scrape`
Fetch a single URL and return its main content as Markdown.

| Argument | Type | Default | Description |
|---|---|---|---|
| `url` | string | — | Absolute `http(s)` URL to fetch. |
| `onlyMainContent` | boolean | `true` | Strip nav/ads/footer and return just the article body. |
| `render` | `auto`\|`http`\|`browser` | `auto` | `auto`: HTTP first, escalate to the browser for JS apps or blocked pages. `http`: fast, HTTP only. `browser`: force JS rendering + stealth. |

### `crawl`
Breadth-first crawl a site and return every page as Markdown.

| Argument | Type | Default | Description |
|---|---|---|---|
| `url` | string | — | URL to start from. |
| `maxDepth` | number | `2` | Link depth to follow from the seed. |
| `maxPages` | number | `20` | Maximum pages to fetch. |
| `sameDomain` | boolean | `true` | Only follow links on the seed's host. |
| `render` | `auto`\|`http`\|`browser` | `auto` | Render mode per page (see `scrape`). |

### `screenshot`
Render a URL in a real browser (residential + stealth) and return a PNG image.

| Argument | Type | Default | Description |
|---|---|---|---|
| `url` | string | — | Absolute `http(s)` URL to screenshot. |

> Browser mode downloads a Chromium build (~150MB) on first use — one-time, automatic. The HTTP path needs no browser.

## Why HatFetch

| | Plain `fetch` / basic MCP | Hosted scraping APIs | **HatFetch** |
|---|:---:|:---:|:---:|
| Clean Markdown for LLMs | ❌ | ✅ | ✅ |
| Renders JavaScript / SPA sites | ❌ | ✅ | ✅ (auto) |
| Runs locally, no API middleman | ✅ | ❌ | ✅ |
| Gets past IP blocks & geo-walls | ❌ | ✅ | ✅ (residential) |
| Gets past common anti-bot | ❌ | ✅ | ✅ (browser + residential) |
| Bring your own proxies | ❌ | ❌ | ✅ |
| Free & open source (MIT) | ✅ | ❌ | ✅ |
| Per-request cost | free | 💲 per page | free + proxy bandwidth |

## Configuration

All configuration is via environment variables.

| Variable | Description |
|---|---|
| `PROXYHAT_API_KEY` | **Simplest.** Your ProxyHat API key — HatFetch auto-selects an active residential sub-user via the API. |
| `PROXYHAT_SUBUSER` | With the API key: pick a specific sub-user by `uuid` or `name` (default: first active one with traffic). |
| `PROXYHAT_USERNAME` | Alternative to the API key: a sub-user **proxy username** (gateway login). |
| `PROXYHAT_PASSWORD` | Sub-user **proxy password** (used with `PROXYHAT_USERNAME`). |
| `PROXYHAT_COUNTRY` | ISO country code to exit from, or `any` (default). |
| `PROXYHAT_REGION` | Optional state/region to target (e.g. `california`). |
| `PROXYHAT_CITY` | Optional city to target (e.g. `new_york`). |
| `PROXYHAT_STICKY` | Keep one IP for a session, e.g. `30m` or `12h`. Omit for rotating IPs. |
| `PROXYHAT_FILTER` | AI IP-quality filter: `medium` (default), `high`, `high-speed-fast`, `medium-speed-fast`, or `none`. |
| `PROXY_URL` | Any generic `http(s)://user:pass@host:port` proxy (alternative to the above). |

> HatFetch connects to the ProxyHat HTTP gateway (`gate.proxyhat.com:8080`) and builds the targeting username for you. Prefer full API-driven provisioning (minting connection URLs via `POST /v1/proxy-descriptors`)? Set `PROXY_URL` to the minted URL instead.

## Verify your setup

Run the built-in self-test to confirm your install and proxy credentials work end-to-end — it compares your direct IP against the proxied exit IP and checks rotation:

```bash
PROXYHAT_API_KEY=your-key npx -y hatfetch --selftest
```
```
  ✓ Direct connection works — your IP is 203.0.113.5
  ✓ Proxy resolved — ProxyHat residential (via API key)
  ✓ Traffic is routed through the proxy — exit IP is 183.88.219.209 (not your 203.0.113.5)
  ✓ IP rotation works — second request exited from 73.149.15.4
  ✓ Scrape pipeline works — fetched and parsed example.com
```

Other commands: `hatfetch --version`, `hatfetch --help`.

## How it works

HatFetch escalates from cheap to powerful, only paying for what a page needs:

1. **HTTP fetch** with a realistic User-Agent (direct or through your proxy). Detects blocks — anti-bot status codes (`403`/`429`/`503`) and challenge/block-page signatures from the major vendors (Cloudflare, DataDome, PerimeterX, Incapsula, Akamai) — and retries through a fresh residential IP.
2. **Auto-escalate to the browser** when the page is an empty JS shell, or was blocked/reset. A real [Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) Chromium (patched to defeat headless fingerprinting) loads the page through the residential proxy, waits for the network to settle, and scrolls to trigger lazy content.
3. **Extract** the main content with Mozilla Readability and convert to Markdown with Turndown.
4. **Be honest** — if even the browser lands on a challenge/block page, HatFetch returns an actionable error instead of passing the block page off as content.

Safety: a built-in SSRF guard refuses internal/loopback/metadata addresses, and tool output is size-capped so a huge page can't blow your context window.

## Development

```bash
npm install
npm run build      # compile to dist/
npm test           # vitest
npm run dev        # run from source (tsx)
```

## Roadmap

- `search` tool (query → results → scrape)
- Structured extraction (CSS / schema)
- Page actions (click, fill, login flows)
- Optional CAPTCHA-solver hook for the hardest targets
- Python edition

## License

MIT © [ProxyHat](https://proxyhat.com)

<div align="center">
<sub>Built by <a href="https://proxyhat.com">ProxyHat</a> — residential & mobile proxies for people who scrape the hard web.</sub>
</div>
