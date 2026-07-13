import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/html/markdown.js";

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
