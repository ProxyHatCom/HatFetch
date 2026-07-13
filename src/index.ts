#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { HatFetchError } from "./fetch/client.js";
import { hasProxy, resolveProxySpec } from "./fetch/proxy.js";
import { crawlSite } from "./tools/crawl.js";
import { scrapePage } from "./tools/scrape.js";
import { createRequire } from "node:module";

const { version: VERSION } = createRequire(import.meta.url)("../package.json") as { version: string };

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
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
      "Automatically retries through residential proxies when the site blocks bots " +
      "(Cloudflare, DataDome, 403/429, CAPTCHA walls). Use for reading docs, articles, " +
      "product pages, search results, or any single page.",
    inputSchema: {
      url: z.string().url().describe("Absolute http(s) URL to fetch."),
      onlyMainContent: z
        .boolean()
        .optional()
        .describe("Extract just the main article/content, stripping nav/ads/footer. Default true."),
    },
  },
  async ({ url, onlyMainContent }): Promise<ToolResult> => {
    try {
      const out = await scrapePage(url, onlyMainContent ?? true);
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
    },
  },
  async ({ url, maxDepth, maxPages, sameDomain }): Promise<ToolResult> => {
    try {
      const { pages, errors } = await crawlSite(url, {
        maxDepth,
        maxPages,
        sameDomain: sameDomain ?? true,
      });

      if (pages.length === 0) {
        // Surface the first error (often the proxy funnel message) as the tool error.
        return errors[0] ? fail(new HatFetchError("crawl failed", errors[0].error)) : ok("_(no pages crawled)_");
      }

      const sections = pages.map((p) => {
        const heading = p.title ? `# ${p.title}` : `# ${p.url}`;
        return `${heading}\n> Source: ${p.url}\n\n${p.markdown || "_(no textual content found)_"}`;
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

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

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

main().catch((err) => {
  console.error("HatFetch failed to start:", err);
  process.exit(1);
});
