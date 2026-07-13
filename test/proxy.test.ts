import { describe, expect, it } from "vitest";
import { hasProxy, resolveProxySpec } from "../src/fetch/proxy.js";

// Note: the gateway username grammar now lives in (and is tested by) the official
// `proxyhat` SDK (buildProxyUsername). Here we test HatFetch's proxy resolution:
// source precedence, URL assembly, and API-key sub-user selection.

describe("resolveProxySpec", () => {
  it("returns null when nothing is configured", async () => {
    expect(await resolveProxySpec({})).toBeNull();
    expect(hasProxy({})).toBe(false);
  });

  it("prefers explicit gateway username + password", async () => {
    const spec = await resolveProxySpec({ PROXYHAT_USERNAME: "ph-1", PROXYHAT_PASSWORD: "secret" });
    expect(spec?.isProxyHat).toBe(true);
    expect(spec?.label).toBe("ProxyHat residential");
    expect(spec?.uri).toContain("ph-1-country-any");
    expect(spec?.uri).toContain("@gate.proxyhat.com:8080");
    expect(hasProxy({ PROXYHAT_USERNAME: "ph-1", PROXYHAT_PASSWORD: "secret" })).toBe(true);
  });

  it("does not enable the gateway with only a username", async () => {
    const spec = await resolveProxySpec({ PROXYHAT_USERNAME: "ph-1", PROXY_URL: "http://u:p@host:1" });
    expect(spec?.isProxyHat).toBe(false);
    expect(spec?.label).toBe("custom proxy");
  });

  it("falls back to a generic PROXY_URL", async () => {
    const spec = await resolveProxySpec({ PROXY_URL: "http://u:p@host:8080" });
    expect(spec?.isProxyHat).toBe(false);
    expect(spec?.uri).toBe("http://u:p@host:8080");
  });

  it("treats an API key as configured (hasProxy)", () => {
    expect(hasProxy({ PROXYHAT_API_KEY: "k" })).toBe(true);
  });
});
