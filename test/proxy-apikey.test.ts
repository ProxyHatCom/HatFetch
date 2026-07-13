import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _clearCredsCache, resolveProxySpec } from "../src/fetch/proxy.js";

// The API-key path resolves sub-users through the official `proxyhat` SDK, which
// uses the global fetch — so we stub globalThis.fetch here.
function subUsersResponse(payload: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({ success: status < 400, payload }),
  };
}

beforeEach(() => _clearCredsCache());
afterEach(() => vi.unstubAllGlobals());

describe("resolveProxySpec with PROXYHAT_API_KEY", () => {
  it("looks up a sub-user via the API and builds the gateway URI", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        subUsersResponse([
          { uuid: "u1", proxy_username: "abc123", proxy_password: "pw", traffic_limit: 1000, used_traffic: 10, suspended_at: null },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const spec = await resolveProxySpec({ PROXYHAT_API_KEY: "key-1" });
    expect(spec?.isProxyHat).toBe(true);
    expect(spec?.label).toBe("ProxyHat residential (via API key)");
    expect(spec?.uri).toContain("abc123-country-any");
    expect(spec?.uri).toContain("@gate.proxyhat.com:8080");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.proxyhat.com/v1/sub-users");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer key-1" });
  });

  it("skips suspended / out-of-traffic sub-users and picks the first usable one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        subUsersResponse([
          { uuid: "s", proxy_username: "suspended", proxy_password: "pw", traffic_limit: 1000, used_traffic: 10, suspended_at: "2026-01-01" },
          { uuid: "o", proxy_username: "overlimit", proxy_password: "pw", traffic_limit: 100, used_traffic: 100, suspended_at: null },
          { uuid: "g", proxy_username: "good", proxy_password: "pw", traffic_limit: 0, used_traffic: 999, suspended_at: null },
        ]),
      ),
    );
    const spec = await resolveProxySpec({ PROXYHAT_API_KEY: "key-2" });
    expect(spec?.uri).toContain("good-country-any");
  });

  it("honors PROXYHAT_SUBUSER selection by uuid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        subUsersResponse([
          { uuid: "u1", proxy_username: "first", proxy_password: "pw", traffic_limit: 0, used_traffic: 0, suspended_at: null },
          { uuid: "u2", proxy_username: "second", proxy_password: "pw", traffic_limit: 0, used_traffic: 0, suspended_at: null },
        ]),
      ),
    );
    const spec = await resolveProxySpec({ PROXYHAT_API_KEY: "key-3", PROXYHAT_SUBUSER: "u2" });
    expect(spec?.uri).toContain("second-country-any");
  });

  it("throws a helpful error on an unauthorized API key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(subUsersResponse(null, 401)));
    await expect(resolveProxySpec({ PROXYHAT_API_KEY: "bad" })).rejects.toThrowError(/PROXYHAT_API_KEY/);
  });

  it("throws when no usable sub-user exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        subUsersResponse([
          { uuid: "s", proxy_username: "x", proxy_password: "pw", traffic_limit: 100, used_traffic: 100, suspended_at: null },
        ]),
      ),
    );
    await expect(resolveProxySpec({ PROXYHAT_API_KEY: "key-4" })).rejects.toThrowError(/No usable ProxyHat sub-user/);
  });
});
