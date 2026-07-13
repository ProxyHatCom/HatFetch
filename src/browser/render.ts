import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { chromium, type Browser } from "patchright";
import type { ProxySpec } from "../fetch/proxy.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export interface RenderResult {
  html: string;
  finalUrl: string;
  status: number;
  screenshot?: Buffer;
}

export interface RenderOptions {
  proxy?: ProxySpec | null;
  timeoutMs?: number;
  /** Scroll the page to trigger lazy-loaded content. Default true. */
  scroll?: boolean;
  /** Capture a PNG screenshot of the viewport. Default false. */
  screenshot?: boolean;
  /**
   * Block images/media/fonts to save (metered) residential bandwidth. Default
   * false: some JS-heavy / anti-bot sites break or serve stripped content when
   * resources are blocked, so full loading is the safe default.
   */
  blockAssets?: boolean;
}

let browserPromise: Promise<Browser> | null = null;

/** Download Patchright's Chromium on first use (lazy — keeps `npx` install light). */
async function installChromium(): Promise<void> {
  const pkgJson = require.resolve("patchright/package.json");
  const cli = path.join(path.dirname(pkgJson), "cli.js");
  console.error("HatFetch: downloading Chromium for browser mode (one-time, ~150MB)…");
  await execFileAsync(process.execPath, [cli, "install", "chromium"], { timeout: 300_000 });
}

/** Launch (or reuse) a single headless browser, downloading Chromium if missing. */
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      try {
        return await chromium.launch({ headless: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/executable doesn.?t exist|install|download/i.test(msg)) {
          await installChromium();
          return chromium.launch({ headless: true });
        }
        throw err;
      }
    })();
    browserPromise.catch(() => {
      browserPromise = null; // allow a later retry if launch failed
    });
  }
  return browserPromise;
}

async function autoScroll(page: import("patchright").Page): Promise<void> {
  await page
    .evaluate(async () => {
      await new Promise<void>((resolve) => {
        let total = 0;
        const step = 600;
        const timer = setInterval(() => {
          window.scrollBy(0, step);
          total += step;
          if (total >= document.body.scrollHeight || total > 15000) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    })
    .catch(() => {});
}

/**
 * Render a URL in a real (stealth-patched) browser and return the final HTML.
 * A fresh context per call keeps sessions isolated and, for rotating proxies,
 * yields a fresh residential IP each time.
 */
export async function renderPage(url: string, options: RenderOptions = {}): Promise<RenderResult> {
  const { proxy, timeoutMs = 45_000, scroll = true, screenshot = false, blockAssets = false } = options;
  const browser = await getBrowser();

  const context = await browser.newContext({
    ...(proxy ? { proxy: { server: proxy.server, username: proxy.username, password: proxy.password } } : {}),
    locale: "en-US",
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
  });

  // Optionally skip images/media/fonts to save (metered) residential bandwidth.
  // Off by default and never when capturing a screenshot.
  if (blockAssets && !screenshot) {
    await context.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "media" || type === "font") route.abort().catch(() => {});
      else route.continue().catch(() => {});
    });
  }

  try {
    const page = await context.newPage();
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Let SPA/network settle, then scroll to pull in lazy content.
    await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
    if (scroll) await autoScroll(page);
    await page.waitForTimeout(400);

    const html = await page.content();
    const shot = screenshot ? await page.screenshot({ type: "png" }) : undefined;
    return {
      html,
      finalUrl: page.url() || url,
      status: resp?.status() ?? 0,
      ...(shot ? { screenshot: shot } : {}),
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/** Close the shared browser (for graceful shutdown / tests). */
export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    await b?.close().catch(() => {});
  }
}
