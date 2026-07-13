import { describe, expect, it } from "vitest";
import { buildProxy, buildProxyHatUsername, hasProxy } from "../src/fetch/proxy.js";

describe("buildProxyHatUsername", () => {
  it("always includes a country, defaulting to 'any'", () => {
    expect(buildProxyHatUsername("ph-8f2a1c")).toBe("ph-8f2a1c-country-any");
  });

  it("encodes country, city and filter in order", () => {
    expect(
      buildProxyHatUsername("ph-8f2a1c", { country: "US", city: "New York", filter: "High" }),
    ).toBe("ph-8f2a1c-country-us-city-new_york-filter-high");
  });

  it("adds a random sticky session id + ttl when sticky is requested", () => {
    const u = buildProxyHatUsername("ph-8f2a1c", { sticky: "30m" });
    expect(u).toMatch(/^ph-8f2a1c-country-any-sid-[0-9a-f]{16}-ttl-30m$/);
  });

  it("defaults sticky ttl to 30m for a bare truthy flag", () => {
    const u = buildProxyHatUsername("ph-8f2a1c", { sticky: "true" });
    expect(u).toMatch(/-ttl-30m$/);
  });

  it("omits session tokens entirely when not sticky (rotating)", () => {
    expect(buildProxyHatUsername("ph-8f2a1c", { country: "de" })).not.toContain("-sid-");
  });
});

describe("buildProxy", () => {
  it("returns null when nothing is configured", () => {
    expect(buildProxy({})).toBeNull();
    expect(hasProxy({})).toBe(false);
  });

  it("prefers the ProxyHat gateway when username + password are set", () => {
    const cfg = buildProxy({ PROXYHAT_USERNAME: "ph-1", PROXYHAT_PASSWORD: "secret" });
    expect(cfg?.isProxyHat).toBe(true);
    expect(cfg?.label).toBe("ProxyHat residential");
    expect(hasProxy({ PROXYHAT_USERNAME: "ph-1", PROXYHAT_PASSWORD: "secret" })).toBe(true);
  });

  it("does not enable ProxyHat with only a username", () => {
    const cfg = buildProxy({ PROXYHAT_USERNAME: "ph-1", PROXY_URL: "http://u:p@host:1" });
    expect(cfg?.isProxyHat).toBe(false);
    expect(cfg?.label).toBe("custom proxy");
  });

  it("falls back to a generic PROXY_URL", () => {
    const cfg = buildProxy({ PROXY_URL: "http://u:p@host:8080" });
    expect(cfg?.isProxyHat).toBe(false);
    expect(cfg?.label).toBe("custom proxy");
  });
});
