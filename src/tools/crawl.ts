import { HatFetchError } from "../fetch/client.js";
import { scrapePage } from "./scrape.js";

export interface CrawlPage {
  url: string;
  title: string | null;
  markdown: string;
}

export interface CrawlError {
  url: string;
  error: string;
}

export interface CrawlOutput {
  pages: CrawlPage[];
  errors: CrawlError[];
}

export interface CrawlOptions {
  maxDepth?: number;
  maxPages?: number;
  sameDomain?: boolean;
  env?: NodeJS.ProcessEnv;
}

/** Canonicalize a URL for dedup: drop the fragment, keep everything else. */
function normalize(url: string): string {
  const u = new URL(url);
  u.hash = "";
  return u.toString();
}

/**
 * Breadth-first crawl starting from `seed`, reusing the scrape pipeline (and thus
 * the same proxy/block handling) for every page. Bounded by `maxPages` (successful
 * pages) and `maxDepth`; stays on the seed's host when `sameDomain` is true.
 */
export async function crawlSite(seed: string, options: CrawlOptions = {}): Promise<CrawlOutput> {
  const { maxDepth = 2, maxPages = 20, sameDomain = true, env = process.env } = options;

  const start = normalize(seed);
  const seedHost = new URL(start).host;

  const visited = new Set<string>([start]);
  const queue: Array<{ url: string; depth: number }> = [{ url: start, depth: 0 }];
  const pages: CrawlPage[] = [];
  const errors: CrawlError[] = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const { url, depth } = queue.shift()!;

    try {
      const page = await scrapePage(url, true, env);
      pages.push({ url: page.url, title: page.title, markdown: page.markdown });

      if (depth < maxDepth) {
        for (const link of page.links) {
          let n: string;
          try {
            n = normalize(link);
          } catch {
            continue;
          }
          if (visited.has(n)) continue;
          if (sameDomain && new URL(n).host !== seedHost) continue;
          visited.add(n);
          queue.push({ url: n, depth: depth + 1 });
        }
      }
    } catch (err) {
      errors.push({
        url,
        error: err instanceof HatFetchError ? err.userMessage : err instanceof Error ? err.message : String(err),
      });
      // If the very first page is blocked, stop early — the whole crawl will fail
      // the same way, and the error already carries the proxy funnel message.
      if (pages.length === 0 && depth === 0) break;
    }
  }

  return { pages, errors };
}
