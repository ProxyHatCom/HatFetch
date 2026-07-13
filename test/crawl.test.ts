import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return { ...actual, fetch: fetchMock };
});

const { crawlSite } = await import("../src/tools/crawl.js");

function page(url: string, body: string) {
  return {
    status: 200,
    url,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/html" : null) },
    text: async () => body,
  };
}

const SITE: Record<string, string> = {
  "https://docs.example/": `<article><h1>Home</h1><p>Welcome to the docs, plenty of readable body text here to
    satisfy the extractor.</p><a href="/a">A</a> <a href="/b">B</a>
    <a href="https://external.example/x">External</a></article>`,
  "https://docs.example/a": `<article><h1>Page A</h1><p>Article A has a good amount of content so it is treated
    as the main region.</p><a href="/c">C</a></article>`,
  "https://docs.example/b": `<article><h1>Page B</h1><p>Article B likewise carries enough readable text to be
    the primary content of this page.</p></article>`,
  "https://docs.example/c": `<article><h1>Page C</h1><p>Should not be reached at depth 1.</p></article>`,
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    const body = SITE[url] ?? SITE[url.replace(/\/$/, "")];
    if (!body) throw new Error(`unexpected url ${url}`);
    return page(url, body);
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
    // /c is depth 2, beyond maxDepth 1.
    expect(urls).not.toContain("https://docs.example/c");
    expect(pages).toHaveLength(3);
  });

  it("respects maxPages", async () => {
    const { pages } = await crawlSite("https://docs.example/", { maxDepth: 2, maxPages: 2, env: {} });
    expect(pages).toHaveLength(2);
  });
});
