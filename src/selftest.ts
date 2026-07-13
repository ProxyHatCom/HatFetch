import { fetchPage, HatFetchError } from "./fetch/client.js";
import { hasProxy, resolveProxySpec } from "./fetch/proxy.js";

const IP_URL = "https://api.ipify.org";

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m: string) => console.log(`  · ${m}`);

/**
 * `hatfetch --selftest`: verify the install and proxy configuration end-to-end.
 * Compares the direct IP against the proxied IP, checks rotation, and exercises
 * the scrape pipeline. Returns a process exit code (0 = all good).
 */
export async function runSelfTest(version: string): Promise<number> {
  console.log(`\nHatFetch ${version} — self-test\n`);
  let failed = false;

  // 1. Direct connectivity + IP baseline.
  let directIp = "";
  try {
    directIp = (await fetchPage(IP_URL, { env: {} })).body.trim();
    ok(`Direct connection works — your IP is ${directIp}`);
  } catch (err) {
    bad(`Direct connection failed: ${msg(err)}`);
    return 1; // Nothing else can pass without basic connectivity.
  }

  // 2. Proxy configuration.
  if (!hasProxy(process.env)) {
    info("No proxy configured (PROXYHAT_API_KEY / PROXYHAT_USERNAME+PASSWORD / PROXY_URL).");
    info("Set PROXYHAT_API_KEY to route through residential IPs — get a key at https://proxyhat.com");
  } else {
    try {
      const spec = await resolveProxySpec(process.env);
      ok(`Proxy resolved — ${spec?.label}`);

      // 3. Proxied IP must differ from the direct IP.
      const ip1 = (await fetchPage(IP_URL, { env: process.env, maxProxyRetries: 1 })).body.trim();
      if (ip1 && ip1 !== directIp) {
        ok(`Traffic is routed through the proxy — exit IP is ${ip1} (not your ${directIp})`);
      } else {
        bad(`Proxied IP (${ip1}) matches your direct IP — traffic is NOT going through the proxy`);
        failed = true;
      }

      // 4. Rotation (informational — sticky sessions legitimately repeat).
      const ip2 = (await fetchPage(IP_URL, { env: process.env, maxProxyRetries: 1 })).body.trim();
      if (ip2 && ip2 !== ip1) ok(`IP rotation works — second request exited from ${ip2}`);
      else info(`Second request reused ${ip2} (expected if PROXYHAT_STICKY is set).`);
    } catch (err) {
      bad(`Proxy check failed: ${msg(err)}`);
      failed = true;
    }
  }

  // 5. Scrape pipeline (HTML → Markdown).
  try {
    const res = await fetchPage("https://example.com", { env: {} });
    if (/example domain/i.test(res.body)) ok("Scrape pipeline works — fetched and parsed example.com");
    else bad("Scrape pipeline returned unexpected content");
  } catch (err) {
    bad(`Scrape pipeline failed: ${msg(err)}`);
    failed = true;
  }

  console.log(failed ? "\n\x1b[31mSelf-test FAILED.\x1b[0m See above.\n" : "\n\x1b[32mAll checks passed.\x1b[0m\n");
  return failed ? 1 : 0;
}

function msg(err: unknown): string {
  if (err instanceof HatFetchError) return err.userMessage;
  return err instanceof Error ? err.message : String(err);
}
