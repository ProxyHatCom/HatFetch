<div align="center">

# 🎩 HatFetch

**Give any LLM agent the power to read _any_ website — even the ones that block bots.**

Clean Markdown out. Blocks handled automatically.

[![npm](https://img.shields.io/npm/v/hatfetch)](https://www.npmjs.com/package/hatfetch)
[![license](https://img.shields.io/npm/l/hatfetch)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-server-000)](https://modelcontextprotocol.io)

</div>

---

HatFetch is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude, Cursor, and any MCP client two tools — `scrape` and `crawl` — that turn web pages into clean, LLM-ready Markdown.

The difference from a plain `fetch`: when a site blocks bots (Cloudflare, DataDome, PerimeterX, `403`/`429`, CAPTCHA walls), HatFetch **detects it and retries through residential proxies automatically**. Your agent stops getting `Access Denied` and starts getting content.

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

### `crawl`
Breadth-first crawl a site and return every page as Markdown.

| Argument | Type | Default | Description |
|---|---|---|---|
| `url` | string | — | URL to start from. |
| `maxDepth` | number | `2` | Link depth to follow from the seed. |
| `maxPages` | number | `20` | Maximum pages to fetch. |
| `sameDomain` | boolean | `true` | Only follow links on the seed's host. |

## Why HatFetch

| | Plain `fetch` / basic MCP | Hosted scraping APIs | **HatFetch** |
|---|:---:|:---:|:---:|
| Clean Markdown for LLMs | ❌ | ✅ | ✅ |
| Runs locally, no API middleman | ✅ | ❌ | ✅ |
| Gets past bot detection | ❌ | ✅ | ✅ (residential proxies) |
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

1. **Fetch** the URL with a realistic browser User-Agent (direct, or through your proxy).
2. **Detect blocks** — anti-bot status codes (`403`/`429`/`503`) and challenge-page signatures from the major vendors.
3. **Retry** through a fresh residential IP when blocked (proxies rotate per request).
4. **Extract** the main content with Mozilla Readability and convert it to Markdown with Turndown.

If a page can't be retrieved, the tool returns an honest, actionable message instead of failing silently.

## Development

```bash
npm install
npm run build      # compile to dist/
npm test           # vitest
npm run dev        # run from source (tsx)
```

## Roadmap

- Optional headless rendering for JS-heavy SPAs
- `search` tool (query → results → scrape)
- Screenshot output
- Python edition

## License

MIT © [ProxyHat](https://proxyhat.com)

<div align="center">
<sub>Built by <a href="https://proxyhat.com">ProxyHat</a> — residential & mobile proxies for people who scrape the hard web.</sub>
</div>
