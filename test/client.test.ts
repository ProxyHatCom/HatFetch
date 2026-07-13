import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock only `fetch` from undici; keep the real ProxyAgent so proxy.ts works.
const fetchMock = vi.fn();
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return { ...actual, fetch: fetchMock };
});

const { fetchPage, HatFetchError } = await import("../src/fetch/client.js");

interface FakeResponse {
  status: number;
  body: string;
  contentType?: string;
  url?: string;
}

function fakeResponse({ status, body, contentType = "text/html", url = "" }: FakeResponse) {
  return {
    status,
    url,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : null) },
    text: async () => body,
  };
}

beforeEach(() => fetchMock.mockReset());
afterEach(() => vi.unstubAllEnvs());

describe("fetchPage", () => {
  it("returns page text on success via a direct connection", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ status: 200, body: "<h1>ok</h1>" }));
    const res = await fetchPage("https://example.com", { env: {} });
    expect(res.status).toBe(200);
    expect(res.body).toContain("ok");
    expect(res.via).toBe("direct connection");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws the proxy funnel message when blocked with no proxy configured", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ status: 403, body: "denied" }));
    const err = await fetchPage("https://shop.example/p", { env: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(HatFetchError);
    expect((err as InstanceType<typeof HatFetchError>).userMessage).toContain("PROXYHAT_USERNAME");
    expect((err as InstanceType<typeof HatFetchError>).userMessage).toContain("proxyhat.com");
    // Only one attempt because no proxy is configured.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries through the proxy and succeeds after a block", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ status: 403, body: "denied" }))
      .mockResolvedValueOnce(fakeResponse({ status: 200, body: "<h1>through</h1>" }));
    const env = { PROXYHAT_USERNAME: "ph-1", PROXYHAT_PASSWORD: "secret" };
    const res = await fetchPage("https://shop.example/p", { env });
    expect(res.body).toContain("through");
    expect(res.via).toBe("ProxyHat residential");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up with the heavily-protected hint after exhausting proxy retries", async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: 403, body: "denied" }));
    const env = { PROXYHAT_USERNAME: "ph-1", PROXYHAT_PASSWORD: "secret" };
    await expect(fetchPage("https://hard.example", { env, maxProxyRetries: 2 })).rejects.toMatchObject({
      constructor: HatFetchError,
    });
    // 1 initial + 2 retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces genuine HTTP errors plainly (404 is not a bot block)", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ status: 404, body: "not found" }));
    await expect(fetchPage("https://example.com/missing", { env: {} })).rejects.toThrowError(/404/);
  });

  it("retries a network error through the proxy before failing", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET")).mockRejectedValueOnce(new Error("ECONNRESET"));
    const env = { PROXY_URL: "http://u:p@host:8080" };
    const err = await fetchPage("https://flaky.example", { env, maxProxyRetries: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(HatFetchError);
    expect((err as Error).message).toMatch(/ECONNRESET/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
