import { retrieve, type RenderMode } from "hatbreak";

export interface ScrapeOutput {
  url: string;
  title: string | null;
  markdown: string;
  /** Absolute links found on the page (used by the crawler). */
  links: string[];
  /** How the page was retrieved ("direct connection" | "ProxyHat residential + browser" | ...). */
  via: string;
  screenshot?: Buffer;
}

/**
 * Fetch a single URL and return clean Markdown. Escalates from HTTP to a real
 * browser automatically (see {@link retrieve}). Non-HTML responses are returned
 * as-is. Throws `UnblockError` (from hatbreak) on block/failure.
 */
export async function scrapePage(
  url: string,
  onlyMainContent = true,
  env: NodeJS.ProcessEnv = process.env,
  opts: { render?: RenderMode; screenshot?: boolean } = {},
): Promise<ScrapeOutput> {
  const r = await retrieve(url, {
    onlyMainContent,
    env,
    render: opts.render ?? "auto",
    screenshot: opts.screenshot ?? false,
  });
  return {
    url: r.url,
    title: r.title,
    markdown: r.markdown,
    links: r.links,
    via: r.via,
    ...(r.screenshot ? { screenshot: r.screenshot } : {}),
  };
}
