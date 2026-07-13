import { beforeEach, describe, expect, it, vi } from "vitest";

// Crawl BFS is HatFetch's own logic; the page-fetch engine lives in `hatbreak`.
// Mock scrapePage so we test the crawl traversal (depth, caps, same-domain) in isolation.
vi.mock("../src/tools/scrape.js", () => ({ scrapePage: vi.fn() }));

const { crawlSite } = await import("../src/tools/crawl.js");
const { scrapePage } = await import("../src/tools/scrape.js");
const scrapeMock = vi.mocked(scrapePage);

const SITE: Record<string, { markdown: string; links: string[] }> = {
  "https://docs.example/": {
    markdown: "Home page",
    links: ["https://docs.example/a", "https://docs.example/b", "https://external.example/x"],
  },
  "https://docs.example/a": { markdown: "Page A", links: ["https://docs.example/c"] },
  "https://docs.example/b": { markdown: "Page B", links: [] },
  "https://docs.example/c": { markdown: "Page C", links: [] },
};

beforeEach(() => {
  scrapeMock.mockReset();
  scrapeMock.mockImplementation(async (url: string) => {
    const page = SITE[url] ?? SITE[`${url.replace(/\/$/, "")}`];
    if (!page) throw new Error(`unexpected url ${url}`);
    return { url, title: null, markdown: page.markdown, links: page.links, via: "mock" };
  });
});

describe("crawlSite", () => {
  it("crawls in-domain links up to maxDepth and skips external hosts", async () => {
    const { pages, errors } = await crawlSite("https://docs.example/", { maxDepth: 1, env: {} });
    const urls = pages.map((p) => p.url);
    expect(errors).toHaveLength(0);
    expect(urls).toEqual(
      expect.arrayContaining(["https://docs.example/", "https://docs.example/a", "https://docs.example/b"]),
    );
    expect(urls).not.toContain("https://external.example/x");
    expect(urls).not.toContain("https://docs.example/c"); // depth 2, beyond maxDepth 1
    expect(pages).toHaveLength(3);
  });

  it("respects maxPages", async () => {
    const { pages } = await crawlSite("https://docs.example/", { maxDepth: 2, maxPages: 2, env: {} });
    expect(pages).toHaveLength(2);
  });

  it("passes the render mode through to scrapePage", async () => {
    await crawlSite("https://docs.example/", { maxDepth: 0, render: "browser", env: {} });
    expect(scrapeMock).toHaveBeenCalledWith("https://docs.example/", true, {}, { render: "browser" });
  });
});
