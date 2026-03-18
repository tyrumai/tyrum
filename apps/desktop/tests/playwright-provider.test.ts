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
    const result = await provider.execute(makeAction({ op: "nonexistent_op" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown Web operation: nonexistent_op");
  });

  it("missing op returns error", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({}));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'op' field");
  });

  // -- Navigate back --------------------------------------------------------

  it("navigate_back returns url and title", async () => {
    const provider = makeProvider();
    await provider.execute(makeAction({ op: "navigate", url: "https://example.com/a" }));
    const result = await provider.execute(makeAction({ op: "navigate_back" }));
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "navigate_back" });
    expect((result.evidence as Record<string, unknown>).url).toBeDefined();
  });

  it("navigate_back fails when domain is disallowed after going back", async () => {
    const backend = new RedirectingMockBackend();
    const provider = new PlaywrightProvider(
      { allowedDomains: ["example.com"], headless: true, domainRestricted: true },
      backend,
    );
    // goBack returns currentUrl, which is evil.com
    backend.currentUrl = "https://evil.com/back";
    backend.goBack = async () => {
      backend.calls.push({ method: "goBack", args: [] });
      return { url: backend.currentUrl, title: "Evil" };
    };
    const result = await provider.execute(makeAction({ op: "navigate_back" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("evil.com");
  });

  // -- Hover ----------------------------------------------------------------

  it("hover with selector succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "hover", selector: "#menu-item" }));
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "hover", selector: "#menu-item" });
  });

  it("hover without selector fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "hover" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'selector'");
  });

  // -- Drag -----------------------------------------------------------------

  it("drag with source and target selectors succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "drag", source_selector: "#src", target_selector: "#dst" }),
    );
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "drag",
      sourceSelector: "#src",
      targetSelector: "#dst",
    });
  });

  it("drag without source_selector fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "drag", target_selector: "#dst" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'source_selector' or 'target_selector'");
  });

  it("drag without target_selector fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "drag", source_selector: "#src" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'source_selector' or 'target_selector'");
  });

  // -- Type -----------------------------------------------------------------

  it("type with selector and text succeeds", async () => {
    const provider = makeProvider();
    await provider.execute(makeAction({ op: "navigate", url: "https://example.com/form" }));
    const result = await provider.execute(
      makeAction({ op: "type", selector: "#input", text: "hello", submit: true }),
    );
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "type",
      selector: "#input",
      text: "hello",
      submit: true,
    });
  });

  it("type without text fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "type", selector: "#input" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'selector' or 'text'");
  });

  it("type without selector fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "type", text: "hello" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'selector' or 'text'");
  });

  // -- Select option --------------------------------------------------------

  it("select_option with selector and values succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "select_option", selector: "#dropdown", values: ["a", "b"] }),
    );
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "select_option",
      selector: "#dropdown",
      selected: ["a", "b"],
    });
  });

  it("select_option without values fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "select_option", selector: "#dropdown" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'selector' or 'values'");
  });

  // -- Press key ------------------------------------------------------------

  it("press_key with key succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "press_key", key: "Enter", modifiers: ["Shift"] }),
    );
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "press_key",
      key: "Enter",
      modifiers: ["Shift"],
    });
  });

  it("press_key without key fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "press_key" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'key'");
  });

  // -- Screenshot -----------------------------------------------------------

  it("screenshot returns base64 image", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "screenshot", selector: "#hero", full_page: true }),
    );
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "screenshot",
      mime: "image/png",
      bytesBase64: "bW9jaw==",
    });
  });

  it("screenshot without selector takes full-page screenshot", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "screenshot" }));
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "screenshot" });
  });

  // -- Evaluate -------------------------------------------------------------

  it("evaluate with expression succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "evaluate", expression: "document.title" }),
    );
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "evaluate" });
  });

  it("evaluate without expression fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "evaluate" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'expression'");
  });

  // -- Wait for -------------------------------------------------------------

  it("wait_for with options succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "wait_for", selector: "#loaded", timeout_ms: 5000 }),
    );
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "wait_for",
      matched: true,
      selector: "#loaded",
    });
  });

  it("wait_for with url pattern succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "wait_for", url: "https://example.com/done" }),
    );
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "wait_for",
      matched: true,
      url: "https://example.com/done",
    });
  });

  // -- Tabs -----------------------------------------------------------------

  it("tabs returns tab list", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "tabs" }));
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "tabs",
      active_index: 0,
    });
    expect((result.evidence as Record<string, unknown>).tabs).toBeDefined();
  });

  // -- Upload file ----------------------------------------------------------

  it("upload_file with selector and paths succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({
        op: "upload_file",
        selector: "#file-input",
        paths: ["/tmp/a.txt", "/tmp/b.txt"],
      }),
    );
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "upload_file",
      selector: "#file-input",
      filesUploaded: 2,
    });
  });

  it("upload_file without paths fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "upload_file", selector: "#file-input" }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'selector' or 'paths'");
  });

  // -- Console messages -----------------------------------------------------

  it("console_messages returns messages array", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "console_messages" }));
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "console_messages" });
    expect((result.evidence as Record<string, unknown>).messages).toEqual([]);
  });

  // -- Network requests -----------------------------------------------------

  it("network_requests returns requests array", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "network_requests" }));
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "network_requests" });
    expect((result.evidence as Record<string, unknown>).requests).toEqual([]);
  });

  // -- Resize ---------------------------------------------------------------

  it("resize with width and height succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "resize", width: 1280, height: 720 }));
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "resize", width: 1280, height: 720 });
  });

  it("resize without height fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "resize", width: 1280 }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'width' or 'height'");
  });

  // -- Close ----------------------------------------------------------------

  it("close succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "close" }));
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "close" });
  });

  // -- Handle dialog --------------------------------------------------------

  it("handle_dialog with accept succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "handle_dialog", accept: true, prompt_text: "yes" }),
    );
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "handle_dialog" });
  });

  it("handle_dialog with dismiss succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "handle_dialog", accept: false }));
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "handle_dialog" });
  });

  it("handle_dialog without accept fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "handle_dialog" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'accept'");
  });

  // -- Run code -------------------------------------------------------------

  it("run_code with code succeeds", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "run_code", code: "return 42" }));
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "run_code" });
  });

  it("run_code without code fails", async () => {
    const provider = makeProvider();
    const result = await provider.execute(makeAction({ op: "run_code" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'code'");
  });

  // -- fill_form alias ------------------------------------------------------

  it("fill_form alias routes to fill handler", async () => {
    const provider = makeProvider();
    await provider.execute(makeAction({ op: "navigate", url: "https://example.com/form" }));
    const result = await provider.execute(
      makeAction({ op: "fill_form", selector: "#name", value: "Bob" }),
    );
    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "fill",
      selector: "#name",
      value: "Bob",
    });
  });

  // -- Backend error propagation --------------------------------------------

  it("backend error is caught and returned as failure", async () => {
    const backend = new MockPlaywrightBackend();
    backend.hover = async () => {
      throw new Error("element detached");
    };
    const provider = new PlaywrightProvider(
      { allowedDomains: ["example.com"], headless: true, domainRestricted: true },
      backend,
    );
    const result = await provider.execute(makeAction({ op: "hover", selector: "#gone" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("element detached");
  });

  // -- Capability field -----------------------------------------------------

  it("capabilityIds lists all 21 browser operations", () => {
    const provider = makeProvider();
    expect(provider.capabilityIds).toContain("tyrum.browser.navigate");
    expect(provider.capabilityIds).toContain("tyrum.browser.close");
    expect(provider.capabilityIds).toContain("tyrum.browser.run-code");
    expect(provider.capabilityIds).toHaveLength(21);
  });
});
