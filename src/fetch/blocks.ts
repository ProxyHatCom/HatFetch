/**
 * Bot-block / anti-scraping detection.
 *
 * A response counts as "blocked" when the target refused the request because it
 * decided we were a bot — as opposed to a genuine 404/500. Detection uses the
 * HTTP status plus well-known challenge-page signatures in the body.
 */

/** HTTP statuses commonly returned by anti-bot layers. */
const BLOCK_STATUSES = new Set([403, 429, 503]);

/**
 * Case-insensitive body signatures for the major anti-bot vendors. Kept small and
 * high-signal to avoid false positives on ordinary pages.
 */
const BLOCK_SIGNATURES: RegExp[] = [
  /just a moment\.\.\./i, // Cloudflare interstitial
  /cf-mitigated/i,
  /cf-chl-/i, // Cloudflare challenge assets
  /challenge-platform/i, // Cloudflare Turnstile / challenge
  /_cf_chl_opt/i,
  /turnstile/i,
  /captcha-delivery\.com/i, // DataDome
  /datadome/i,
  /px-captcha/i, // PerimeterX / HUMAN
  /_pxhd/i,
  /perimeterx/i,
  /access denied.*reference #\d/i, // Akamai
  /please enable javascript and cookies to continue/i,
  /are you a human/i,
  /unusual traffic from your (computer|network)/i, // Google
  /g-recaptcha/i,
];

export interface BlockResult {
  blocked: boolean;
  /** Short reason suitable for an error message, when blocked. */
  reason?: string;
}

/**
 * Classify a response as blocked or not.
 *
 * @param status HTTP status code.
 * @param body   Response body text (may be empty; only the head is inspected).
 */
export function detectBlock(status: number, body = ""): BlockResult {
  if (BLOCK_STATUSES.has(status)) {
    return { blocked: true, reason: `HTTP ${status} (bot detection)` };
  }

  // Only inspect the head of the body — challenge markers live near the top and
  // this keeps large pages cheap to scan.
  const head = body.slice(0, 20_000);
  for (const sig of BLOCK_SIGNATURES) {
    if (sig.test(head)) {
      return { blocked: true, reason: `anti-bot challenge page (${sig.source})` };
    }
  }

  return { blocked: false };
}
