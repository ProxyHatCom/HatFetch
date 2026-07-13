import { describe, expect, it } from "vitest";
import { detectBlock } from "../src/fetch/blocks.js";

describe("detectBlock", () => {
  it("flags anti-bot HTTP statuses", () => {
    expect(detectBlock(403).blocked).toBe(true);
    expect(detectBlock(429).blocked).toBe(true);
    expect(detectBlock(503).blocked).toBe(true);
  });

  it("does not flag ordinary errors as bot blocks", () => {
    expect(detectBlock(404).blocked).toBe(false);
    expect(detectBlock(500).blocked).toBe(false);
  });

  it("flags Cloudflare interstitials in a 200 body", () => {
    const res = detectBlock(200, "<html><head><title>Just a moment...</title></head></html>");
    expect(res.blocked).toBe(true);
  });

  it("flags DataDome / PerimeterX / reCAPTCHA challenge markers", () => {
    expect(detectBlock(200, "<script src='https://ct.captcha-delivery.com/x'></script>").blocked).toBe(true);
    expect(detectBlock(200, "<div id='px-captcha'></div>").blocked).toBe(true);
    expect(detectBlock(200, "<div class='g-recaptcha'></div>").blocked).toBe(true);
  });

  it("does not flag ordinary content", () => {
    expect(detectBlock(200, "<html><body><h1>Welcome</h1><p>Normal page.</p></body></html>").blocked).toBe(false);
  });
});
