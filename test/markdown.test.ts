import { describe, expect, it } from "vitest";
import { htmlToMarkdown, looksLikeEmptyShell } from "../src/html/markdown.js";

const ARTICLE = `<!DOCTYPE html>
<html>
  <head><title>Test Article</title></head>
  <body>
    <nav><a href="/home">Home</a> <a href="https://other.example/ad">Sponsored</a></nav>
    <article>
      <h1>The Main Heading</h1>
      <p>This is a substantial paragraph of article content that Readability should
      confidently identify as the primary readable content of the page. It contains
      enough words to clear the extraction heuristics and includes a
      <a href="/related">related link</a> worth following.</p>
      <p>A second paragraph adds more body text so the article is unmistakably the
      main content region rather than the navigation or footer boilerplate.</p>
    </article>
    <footer>Copyright boilerplate footer text.</footer>
  </body>
</html>`;

describe("htmlToMarkdown", () => {
  it("returns the page title", () => {
    const { title } = htmlToMarkdown(ARTICLE, "https://site.example/post");
    expect(title).toBe("Test Article");
  });

  it("converts main content to markdown and drops nav/footer boilerplate", () => {
    const { markdown } = htmlToMarkdown(ARTICLE, "https://site.example/post", true);
    expect(markdown).toContain("The Main Heading");
    expect(markdown).toContain("substantial paragraph");
    expect(markdown).not.toContain("Sponsored");
    expect(markdown).not.toContain("Copyright boilerplate");
  });

  it("resolves links to absolute URLs", () => {
    const { links } = htmlToMarkdown(ARTICLE, "https://site.example/post");
    expect(links).toContain("https://site.example/related");
    expect(links).toContain("https://site.example/home");
    expect(links).toContain("https://other.example/ad");
  });

  it("keeps everything when onlyMainContent is false", () => {
    const { markdown } = htmlToMarkdown(ARTICLE, "https://site.example/post", false);
    expect(markdown).toContain("Sponsored");
  });

  it("falls back gracefully when there is no article", () => {
    const { markdown } = htmlToMarkdown(
      "<html><body><p>tiny</p></body></html>",
      "https://x.example",
      true,
    );
    expect(markdown).toContain("tiny");
  });
});

describe("looksLikeEmptyShell", () => {
  it("flags a tiny SPA shell with an app root", () => {
    const html = `<html><body><div id="root"></div><script src="/app.js"></script></body></html>`;
    expect(looksLikeEmptyShell("Loading…", html)).toBe(true);
  });

  it("flags a tiny page with several scripts", () => {
    const html = `<html><body><script></script><script></script><script></script></body></html>`;
    expect(looksLikeEmptyShell("", html)).toBe(true);
  });

  it("does NOT flag a page with substantial extracted text", () => {
    const big = "word ".repeat(200); // ~1000 chars
    const html = `<html><body><div id="root"></div><script></script></body></html>`;
    expect(looksLikeEmptyShell(big, html)).toBe(false);
  });

  it("does NOT flag a small static page with no app markers", () => {
    expect(looksLikeEmptyShell("short note", "<html><body><p>short note</p></body></html>")).toBe(false);
  });
});
