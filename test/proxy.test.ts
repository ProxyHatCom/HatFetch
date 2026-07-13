import { describe, expect, it } from "vitest";
import { buildProxyHatUsername, hasProxy, resolveProxySpec } from "../src/fetch/proxy.js";

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

  it("emits region between country and city, skipping 'any'", () => {
    expect(buildProxyHatUsername("ph-1", { country: "us", region: "California", city: "Los Angeles" })).toBe(
      "ph-1-country-us-region-california-city-los_angeles",
    );
    expect(buildProxyHatUsername("ph-1", { region: "any" })).toBe("ph-1-country-any");
  });

  it("appends NO filter token for 'none'", () => {
    expect(buildProxyHatUsername("ph-1", { filter: "none" })).toBe("ph-1-country-any");
  });

  it("accepts a filter value with or without the leading 'filter-'", () => {
    expect(buildProxyHatUsername("ph-1", { filter: "high" })).toBe("ph-1-country-any-filter-high");
    expect(buildProxyHatUsername("ph-1", { filter: "filter-high-speed-fast" })).toBe(
      "ph-1-country-any-filter-high-speed-fast",
    );
  });
});

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
