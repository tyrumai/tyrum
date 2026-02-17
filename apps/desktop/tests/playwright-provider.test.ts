import { describe, expect, it } from "vitest";
import type { ActionPrimitive } from "@tyrum/schemas";
import {
  PlaywrightProvider,
  type PlaywrightProviderConfig,
} from "../src/main/providers/playwright-provider.js";
import { MockPlaywrightBackend } from "../src/main/providers/backends/playwright-backend.js";

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

  it("invalid URL returns error", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "navigate", url: "not-a-url" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid URL");
  });

  // -- Click ----------------------------------------------------------------

  it("click with selector succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "click", selector: "#submit-btn" }),
    );
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "click",
      selector: "#submit-btn",
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
    const result = await provider.execute(
      makeAction({ op: "fill", selector: "#email", value: "a@b.com" }),
    );
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "fill",
      selector: "#email",
      value: "a@b.com",
    });
  });

  it("fill with missing value fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "fill", selector: "#email" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'selector' or 'value'");
  });

  // -- Snapshot -------------------------------------------------------------

  it("snapshot returns success", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "snapshot" }));
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "snapshot" });
  });

  // -- Unknown / Missing op -------------------------------------------------

  it("unknown op returns error", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "hover" }),
    );
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
