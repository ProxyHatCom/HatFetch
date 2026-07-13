import { fetchPage } from "../fetch/client.js";
import { htmlToMarkdown } from "../html/markdown.js";

export interface ScrapeOutput {
  url: string;
  title: string | null;
  markdown: string;
  /** Absolute links found on the page (used by the crawler). */
  links: string[];
  /** How the page was retrieved ("direct connection" | "ProxyHat residential" | ...). */
  via: string;
}

/**
 * Fetch a single URL and return clean Markdown. HTML is run through main-content
 * extraction (unless `onlyMainContent` is false); non-HTML responses are returned
 * as-is so the caller still gets the raw text (JSON, plain text, etc.).
 *
 * Throws {@link import("../fetch/client.js").HatFetchError} on block / failure.
 */
export async function scrapePage(
  url: string,
  onlyMainContent = true,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ScrapeOutput> {
  const res = await fetchPage(url, { env });

  const isHtml = res.contentType.includes("html") || res.contentType === "";
  if (!isHtml) {
    return { url: res.url, title: null, markdown: res.body, links: [], via: res.via };
  }

  const { title, markdown, links } = htmlToMarkdown(res.body, res.url, onlyMainContent);
  return { url: res.url, title, markdown, links, via: res.via };
}
