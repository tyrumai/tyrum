import { describe, expect, it } from "vitest";
import type { ActionPrimitive } from "@tyrum/schemas";
import {
  PlaywrightProvider,
  type PlaywrightProviderConfig,
} from "../src/main/providers/playwright-provider.js";
import { MockPlaywrightBackend } from "./test-utils/mock-playwright-backend.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAction(args: Record<string, unknown>): ActionPrimitive {
  return { type: "Web", args };
}

function makeProvider(overrides: Partial<PlaywrightProviderConfig> = {}) {
  const config: PlaywrightProviderConfig = {
    allowedDomains: ["example.com", "trusted.org"],
    headless: true,
    domainRestricted: true,
    ...overrides,
  };
  const backend = new MockPlaywrightBackend();
  return new PlaywrightProvider(config, backend);
}

class RedirectingMockBackend extends MockPlaywrightBackend {
  currentUrl = "https://example.com";
  navigateRedirectUrl: string | null = null;
  clickRedirectUrl: string | null = null;
  fillRedirectUrl: string | null = null;

  override async navigate(url: string): Promise<{ title: string; url: string }> {
    this.calls.push({ method: "navigate", args: [url] });
    this.currentUrl = this.navigateRedirectUrl ?? url;
    return { title: "Mock Page", url: this.currentUrl };
  }

  override async click(selector: string): Promise<void> {
    this.calls.push({ method: "click", args: [selector] });
    if (this.clickRedirectUrl) this.currentUrl = this.clickRedirectUrl;
  }

  override async fill(selector: string, value: string): Promise<void> {
    this.calls.push({ method: "fill", args: [selector, value] });
    if (this.fillRedirectUrl) this.currentUrl = this.fillRedirectUrl;
  }

  override async snapshot() {
    this.calls.push({ method: "snapshot", args: [] });
    return {
      html: "<html><body>mock</body></html>",
      title: "Mock Page",
      url: this.currentUrl,
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlaywrightProvider", () => {
  // -- Navigate: domain allowlist -------------------------------------------

  it("navigate to allowed domain succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "navigate", url: "https://example.com/page" }),
    );
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "navigate",
      url: "https://example.com/page",
    });
  });

  it("navigate to disallowed domain fails with allowlist error", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "navigate", url: "https://evil.com/steal" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("evil.com");
    expect(result.error).toContain("not in the allowlist");
  });

  it("subdomain of allowed domain succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "navigate", url: "https://sub.example.com/path" }),
    );
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "navigate",
      url: "https://sub.example.com/path",
    });
  });

  it("navigate fails when final redirected domain is disallowed", async () => {
    const backend = new RedirectingMockBackend();
    backend.navigateRedirectUrl = "https://evil.com/landing";
    const provider = new PlaywrightProvider(
      { allowedDomains: ["example.com", "trusted.org"], headless: true, domainRestricted: true },
      backend,
    );
    const result = await provider.execute(
      makeAction({ op: "navigate", url: "https://example.com/start" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("evil.com");
    expect(result.error).toContain("not in the allowlist");
  });

  it("navigate without URL fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "navigate" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'url'");
  });

  it("domain check disabled in unrestricted mode", async () => {
    const provider = makeProvider({ domainRestricted: false });
    const result = await provider.execute(
      makeAction({ op: "navigate", url: "https://anywhere.net/page" }),
    );
    expect(result.success).toBe(true);
  });

  it("domain wildcard entry allows all domains when restricted mode is on", async () => {
    const provider = makeProvider({
      domainRestricted: true,
      allowedDomains: ["*"],
    });
    const result = await provider.execute(
      makeAction({ op: "navigate", url: "https://totally-new-domain.dev/path" }),
    );
    expect(result.success).toBe(true);
  });

  it("invalid URL returns error", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "navigate", url: "not-a-url" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid URL");
  });

  // -- Click ----------------------------------------------------------------

  it("click with selector succeeds", async () => {
    const provider = makeProvider();
    await provider.execute(makeAction({ op: "navigate", url: "https://example.com/form" }));
    const result = await provider.execute(makeAction({ op: "click", selector: "#submit-btn" }));
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "click",
      selector: "#submit-btn",
      url: "https://example.com/form",
    });
  });

  it("click without selector fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "click" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'selector'");
  });

  // -- Fill -----------------------------------------------------------------

  it("fill with selector and value succeeds", async () => {
    const provider = makeProvider();
    await provider.execute(makeAction({ op: "navigate", url: "https://example.com/form" }));
    const result = await provider.execute(
      makeAction({ op: "fill", selector: "#email", value: "a@b.com" }),
    );
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "fill",
      selector: "#email",
      value: "a@b.com",
      url: "https://example.com/form",
    });
  });

  it("click fails when action ends on a disallowed domain", async () => {
    const backend = new RedirectingMockBackend();
    backend.clickRedirectUrl = "https://evil.com/after-click";
    const provider = new PlaywrightProvider(
      { allowedDomains: ["example.com", "trusted.org"], headless: true, domainRestricted: true },
      backend,
    );
    const result = await provider.execute(makeAction({ op: "click", selector: "#submit-btn" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("evil.com");
    expect(result.error).toContain("not in the allowlist");
  });

  it("fill fails when action ends on a disallowed domain", async () => {
    const backend = new RedirectingMockBackend();
    backend.fillRedirectUrl = "https://evil.com/after-fill";
    const provider = new PlaywrightProvider(
      { allowedDomains: ["example.com", "trusted.org"], headless: true, domainRestricted: true },
      backend,
    );
    const result = await provider.execute(
      makeAction({ op: "fill", selector: "#email", value: "a@b.com" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("evil.com");
    expect(result.error).toContain("not in the allowlist");
  });

  it("fill with missing value fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "fill", selector: "#email" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'selector' or 'value'");
  });

  // -- Snapshot -------------------------------------------------------------

  it("snapshot returns success", async () => {
    const provider = makeProvider();
    await provider.execute(makeAction({ op: "navigate", url: "https://example.com/page" }));
    const result = await provider.execute(makeAction({ op: "snapshot" }));
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "snapshot" });
  });

  it("snapshot fails when current page domain is disallowed", async () => {
    const backend = new RedirectingMockBackend();
    backend.currentUrl = "https://evil.com/snap";
    const provider = new PlaywrightProvider(
      { allowedDomains: ["example.com", "trusted.org"], headless: true, domainRestricted: true },
      backend,
    );
    const result = await provider.execute(makeAction({ op: "snapshot" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("evil.com");
    expect(result.error).toContain("not in the allowlist");
  });

  // -- Unknown / Missing op -------------------------------------------------

  it("unknown op returns error", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "hover" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown Web operation: hover");
  });

  it("missing op returns error", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({}));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'op' field");
  });

  // -- Capability field -----------------------------------------------------

  it("capability field is 'playwright'", () => {
    const provider = makeProvider();
    expect(provider.capability).toBe("playwright");
  });
});
