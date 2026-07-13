import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Drop noise that never carries content and only pollutes the Markdown.
turndown.remove(["script", "style", "noscript", "iframe", "svg"] as Array<keyof HTMLElementTagNameMap>);

export interface ExtractResult {
  title: string | null;
  markdown: string;
  /** Absolute URLs discovered in the (main) content — used by the crawler. */
  links: string[];
}

type ParsedDocument = ReturnType<typeof parseHTML>["document"];

/** Collect absolute, http(s) links from a DOM document, resolved against `baseUrl`. */
function collectLinks(document: ParsedDocument, baseUrl: string): string[] {
  const out = new Set<string>();
  for (const a of Array.from(document.querySelectorAll("a[href]")) as Array<{
    getAttribute(name: string): string | null;
  }>) {
    const href = a.getAttribute("href");
    if (!href) continue;
    try {
      const abs = new URL(href, baseUrl);
      if (abs.protocol === "http:" || abs.protocol === "https:") {
        abs.hash = "";
        out.add(abs.toString());
      }
    } catch {
      // Ignore malformed hrefs.
    }
  }
  return [...out];
}

/**
 * Convert an HTML document to clean Markdown.
 *
 * When `onlyMainContent` is true (default) we run Mozilla Readability to strip
 * nav/ads/boilerplate, then convert the article body. If Readability can't find
 * an article (short pages, apps, or DOM quirks), we fall back to converting the
 * whole `<body>` so the tool still returns something useful rather than nothing.
 */
export function htmlToMarkdown(html: string, baseUrl: string, onlyMainContent = true): ExtractResult {
  const { document } = parseHTML(html);
  const links = collectLinks(document, baseUrl);
  const pageTitle = document.title?.trim() || null;

  if (onlyMainContent) {
    try {
      // Readability mutates the document, so parse a fresh copy for extraction.
      const { document: readerDoc } = parseHTML(html);
      const article = new Readability(readerDoc as unknown as Document).parse();
      if (article?.content && article.content.trim()) {
        return {
          title: article.title?.trim() || pageTitle,
          markdown: turndown.turndown(article.content).trim(),
          links,
        };
      }
    } catch {
      // Fall through to whole-body conversion below.
    }
  }

  const body = document.body?.innerHTML ?? html;
  return {
    title: pageTitle,
    markdown: turndown.turndown(body).trim(),
    links,
  };
}
