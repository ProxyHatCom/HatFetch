#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { UnblockError as HatFetchError, closeBrowser, hasProxy, resolveProxySpec } from "hatbreak";
import { crawlSite } from "./tools/crawl.js";
import { scrapePage } from "./tools/scrape.js";
import { createRequire } from "node:module";

const { version: VERSION } = createRequire(import.meta.url)("../package.json") as { version: string };

type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };
type ToolResult = {
  content: ToolContent[];
  isError?: boolean;
};

// Cap tool output so a big page/crawl can't blow the model's context window.
const MAX_OUTPUT_CHARS = 120_000;
function cap(text: string, limit = MAX_OUTPUT_CHARS): string {
  return text.length > limit ? `${text.slice(0, limit)}\n\n…[truncated ${text.length - limit} characters]` : text;
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text: cap(text) }] };
}

/** Turn any thrown error into a tool error, preserving the funnel message. */
function fail(err: unknown): ToolResult {
  const text =
    err instanceof HatFetchError ? err.userMessage : err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text }], isError: true };
}

const server = new McpServer({ name: "hatfetch", version: VERSION });

server.registerTool(
  "scrape",
  {
    title: "Scrape a web page to Markdown",
    description:
      "Fetch a single URL and return its content as clean, LLM-ready Markdown. " +
      "Renders JavaScript sites and gets past bot detection automatically: tries a fast " +
      "HTTP fetch, then escalates to a real stealth browser through residential proxies " +
      "when a page is an empty JS app or is blocked (Cloudflare, DataDome, 403/429). Use " +
      "for docs, articles, product pages, SPAs, or any single page.",
    inputSchema: {
      url: z.string().url().describe("Absolute http(s) URL to fetch."),
      onlyMainContent: z
        .boolean()
        .optional()
        .describe("Extract just the main article/content, stripping nav/ads/footer. Default true."),
      render: z
        .enum(["auto", "http", "browser"])
        .optional()
        .describe(
          "How to fetch. 'auto' (default): HTTP first, escalate to a real browser if needed. " +
            "'http': fast, HTTP only. 'browser': force full JS rendering + stealth fingerprint.",
        ),
    },
  },
  async ({ url, onlyMainContent, render }): Promise<ToolResult> => {
    try {
      const out = await scrapePage(url, onlyMainContent ?? true, process.env, { render });
      const header = out.title ? `# ${out.title}\n\n` : "";
      const meta = `> Source: ${out.url} · retrieved via ${out.via}\n\n`;
      return ok(header + meta + (out.markdown || "_(no textual content found)_"));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "crawl",
  {
    title: "Crawl a website to Markdown",
    description:
      "Breadth-first crawl a site starting from a URL and return each page as clean " +
      "Markdown. Follows in-domain links up to a depth/page limit. Same proxy and " +
      "block-handling as `scrape`. Use to ingest a docs site or section of a site.",
    inputSchema: {
      url: z.string().url().describe("Absolute http(s) URL to start crawling from."),
      maxDepth: z.number().int().min(0).max(5).optional().describe("Link depth from the seed. Default 2."),
      maxPages: z.number().int().min(1).max(100).optional().describe("Max pages to fetch. Default 20."),
      sameDomain: z
        .boolean()
        .optional()
        .describe("Only follow links on the seed's host. Default true."),
      render: z
        .enum(["auto", "http", "browser"])
        .optional()
        .describe("Render mode per page (see scrape). Default 'auto'. 'browser' is slower but handles JS sites."),
    },
  },
  async ({ url, maxDepth, maxPages, sameDomain, render }): Promise<ToolResult> => {
    try {
      const { pages, errors } = await crawlSite(url, {
        maxDepth,
        maxPages,
        sameDomain: sameDomain ?? true,
        render,
      });

      if (pages.length === 0) {
        // Surface the first error (often the proxy funnel message) as the tool error.
        return errors[0] ? fail(new HatFetchError("crawl failed", errors[0].error)) : ok("_(no pages crawled)_");
      }

      const sections = pages.map((p) => {
        const heading = p.title ? `# ${p.title}` : `# ${p.url}`;
        // Cap each page so one huge page can't dominate the crawl output.
        return `${heading}\n> Source: ${p.url}\n\n${cap(p.markdown, 30_000) || "_(no textual content found)_"}`;
      });

      let out = `_Crawled ${pages.length} page(s) from ${url}._\n\n` + sections.join("\n\n---\n\n");
      if (errors.length > 0) {
        out += `\n\n---\n\n_${errors.length} page(s) failed (e.g. ${errors[0]!.url}). ` +
          `Configure residential proxies to reach protected pages — see https://proxyhat.com._`;
      }
      return ok(out);
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "screenshot",
  {
    title: "Screenshot a web page",
    description:
      "Render a URL in a real browser (through residential proxies + stealth) and return a PNG " +
      "screenshot of the page. Use to see a page visually or capture JS-rendered content.",
    inputSchema: {
      url: z.string().url().describe("Absolute http(s) URL to screenshot."),
    },
  },
  async ({ url }): Promise<ToolResult> => {
    try {
      const out = await scrapePage(url, true, process.env, { screenshot: true });
      if (!out.screenshot) return fail(new Error("No screenshot was captured."));
      return { content: [{ type: "image", data: out.screenshot.toString("base64"), mimeType: "image/png" }] };
    } catch (err) {
      return fail(err);
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean up the shared browser on shutdown so Chromium doesn't linger.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      void closeBrowser().finally(() => process.exit(0));
    });
  }

  // Diagnostics go to stderr so they never corrupt the JSON-RPC stream on stdout.
  if (hasProxy()) {
    try {
      const spec = await resolveProxySpec();
      console.error(`HatFetch ${VERSION} ready · proxy: ${spec?.label ?? "configured"}`);
    } catch (err) {
      console.error(
        `HatFetch ${VERSION} ready · proxy config error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    console.error(
      `HatFetch ${VERSION} ready · no proxy configured. Sites with bot detection will be blocked until ` +
        `you set PROXYHAT_API_KEY (simplest — free trial at https://proxyhat.com), PROXYHAT_USERNAME + PROXYHAT_PASSWORD, or PROXY_URL.`,
    );
  }
}

const HELP = `HatFetch ${VERSION} — MCP server that reads any website as clean Markdown, past bot blocks.

Usage:
  hatfetch              Start the MCP server (stdio). Add it to your MCP client config.
  hatfetch --selftest   Verify install + proxy configuration end-to-end.
  hatfetch --version    Print the version.
  hatfetch --help       Show this help.

Proxy (set as env vars):
  PROXYHAT_API_KEY      Simplest — auto-selects a residential sub-user. Key at https://proxyhat.com
  PROXYHAT_USERNAME/PASSWORD, PROXYHAT_COUNTRY/REGION/CITY/STICKY/FILTER, PROXYHAT_SUBUSER, PROXY_URL

Docs: https://github.com/ProxyHatCom/HatFetch`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
} else if (argv.includes("--version") || argv.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
} else if (argv.includes("--selftest")) {
  const { runSelfTest } = await import("./selftest.js");
  process.exit(await runSelfTest(VERSION));
} else {
  main().catch((err) => {
    console.error("HatFetch failed to start:", err);
    process.exit(1);
  });
}
