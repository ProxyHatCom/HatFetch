import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return { ...actual, fetch: fetchMock };
});

const { resolveProxySpec, _clearCredsCache } = await import("../src/fetch/proxy.js");

function subUsersResponse(payload: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => ({ success: true, payload }) };
}

beforeEach(() => {
  fetchMock.mockReset();
  _clearCredsCache();
});

describe("resolveProxySpec with PROXYHAT_API_KEY", () => {
  it("looks up a sub-user via the API and builds the gateway URI", async () => {
    fetchMock.mockResolvedValueOnce(
      subUsersResponse([
        { uuid: "u1", proxy_username: "abc123", proxy_password: "pw", traffic_limit: 1000, used_traffic: 10, suspended_at: null },
      ]),
    );
    const spec = await resolveProxySpec({ PROXYHAT_API_KEY: "key-1" });
    expect(spec?.isProxyHat).toBe(true);
    expect(spec?.label).toBe("ProxyHat residential (via API key)");
    expect(spec?.uri).toContain("abc123-country-any");
    expect(spec?.uri).toContain("@gate.proxyhat.com:8080");
    // The call went to the ProxyHat sub-users endpoint with a bearer token.
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.proxyhat.com/v1/sub-users",
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer key-1" }) }),
    );
  });

  it("skips suspended / out-of-traffic sub-users and picks the first usable one", async () => {
    fetchMock.mockResolvedValueOnce(
      subUsersResponse([
        { uuid: "s", proxy_username: "suspended", proxy_password: "pw", traffic_limit: 1000, used_traffic: 10, suspended_at: "2026-01-01" },
        { uuid: "o", proxy_username: "overlimit", proxy_password: "pw", traffic_limit: 100, used_traffic: 100, suspended_at: null },
        { uuid: "g", proxy_username: "good", proxy_password: "pw", traffic_limit: 0, used_traffic: 999, suspended_at: null },
      ]),
    );
    const spec = await resolveProxySpec({ PROXYHAT_API_KEY: "key-2" });
    expect(spec?.uri).toContain("good-country-any");
  });

  it("honors PROXYHAT_SUBUSER selection by uuid", async () => {
    fetchMock.mockResolvedValueOnce(
      subUsersResponse([
        { uuid: "u1", proxy_username: "first", proxy_password: "pw", traffic_limit: 0, suspended_at: null },
        { uuid: "u2", proxy_username: "second", proxy_password: "pw", traffic_limit: 0, suspended_at: null },
      ]),
    );
    const spec = await resolveProxySpec({ PROXYHAT_API_KEY: "key-3", PROXYHAT_SUBUSER: "u2" });
    expect(spec?.uri).toContain("second-country-any");
  });

  it("throws a helpful error on an unauthorized API key", async () => {
    fetchMock.mockResolvedValueOnce(subUsersResponse(null, 401));
    await expect(resolveProxySpec({ PROXYHAT_API_KEY: "bad" })).rejects.toThrowError(/HTTP 401.*PROXYHAT_API_KEY/);
  });

  it("throws when no usable sub-user exists", async () => {
    fetchMock.mockResolvedValueOnce(
      subUsersResponse([
        { uuid: "s", proxy_username: "x", proxy_password: "pw", traffic_limit: 100, used_traffic: 100, suspended_at: null },
      ]),
    );
    await expect(resolveProxySpec({ PROXYHAT_API_KEY: "key-4" })).rejects.toThrowError(/No usable ProxyHat sub-user/);
  });
});
