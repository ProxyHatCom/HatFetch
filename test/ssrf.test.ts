import { describe, expect, it } from "vitest";
import { assertFetchable } from "../src/fetch/ssrf.js";

describe("assertFetchable", () => {
  it("allows normal public http(s) URLs", () => {
    expect(assertFetchable("https://example.com/path").host).toBe("example.com");
    expect(assertFetchable("http://news.ycombinator.com").hostname).toBe("news.ycombinator.com");
  });

  it("blocks non-http(s) schemes", () => {
    expect(() => assertFetchable("file:///etc/passwd")).toThrow(/non-http/);
    expect(() => assertFetchable("ftp://x/y")).toThrow(/non-http/);
    expect(() => assertFetchable("gopher://x")).toThrow(/non-http/);
  });

  it("blocks localhost and loopback", () => {
    expect(() => assertFetchable("http://localhost:3000")).toThrow(/internal/);
    expect(() => assertFetchable("http://foo.localhost")).toThrow(/internal/);
    expect(() => assertFetchable("http://127.0.0.1")).toThrow(/private|internal/);
    expect(() => assertFetchable("http://127.1.2.3:8080")).toThrow(/private|internal/);
  });

  it("blocks private ranges and cloud metadata", () => {
    expect(() => assertFetchable("http://10.0.0.5")).toThrow(/private/);
    expect(() => assertFetchable("http://192.168.1.1")).toThrow(/private/);
    expect(() => assertFetchable("http://172.16.9.9")).toThrow(/private/);
    expect(() => assertFetchable("http://169.254.169.254/latest/meta-data")).toThrow(/private/);
    expect(() => assertFetchable("http://[::1]/")).toThrow(/private|internal/);
  });

  it("does not block public IPs that merely look adjacent", () => {
    expect(assertFetchable("http://172.15.0.1").hostname).toBe("172.15.0.1"); // just outside 172.16/12
    expect(assertFetchable("http://8.8.8.8").hostname).toBe("8.8.8.8");
  });

  it("throws on malformed URLs", () => {
    expect(() => assertFetchable("not a url")).toThrow(/Invalid URL/);
  });
});
