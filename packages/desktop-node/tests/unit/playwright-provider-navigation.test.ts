import { describe, expect, it } from "vitest";
import {
  makeAction,
  makeProvider,
  RedirectingMockBackend,
} from "../test-utils/playwright-provider-fixture.js";

describe("PlaywrightProvider navigation", () => {
  it("navigate to allowed domain succeeds", async () => {
    const { provider } = makeProvider();
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
    const { provider } = makeProvider();
    const result = await provider.execute(
      makeAction({ op: "navigate", url: "https://evil.com/steal" }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("evil.com");
    expect(result.error).toContain("not in the allowlist");
  });

  it("subdomain of allowed domain succeeds", async () => {
    const { provider } = makeProvider();
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
    const { provider } = makeProvider({}, backend);
    const result = await provider.execute(
      makeAction({ op: "navigate", url: "https://example.com/start" }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("evil.com");
    expect(result.error).toContain("not in the allowlist");
  });

  it("navigate without URL fails", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "navigate" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'url'");
  });

  it("domain check disabled in unrestricted mode", async () => {
    const { provider } = makeProvider({ domainRestricted: false });
    const result = await provider.execute(
      makeAction({ op: "navigate", url: "https://anywhere.net/page" }),
    );

    expect(result.success).toBe(true);
  });

  it("domain wildcard entry allows all domains when restricted mode is on", async () => {
    const { provider } = makeProvider({
      domainRestricted: true,
      allowedDomains: ["*"],
    });
    const result = await provider.execute(
      makeAction({ op: "navigate", url: "https://totally-new-domain.dev/path" }),
    );

    expect(result.success).toBe(true);
  });

  it("invalid URL returns error", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "navigate", url: "not-a-url" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid URL");
  });

  it("click with selector succeeds", async () => {
    const { provider } = makeProvider();
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
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "click" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'selector'");
  });

  it("fill with selector and value succeeds", async () => {
    const { provider } = makeProvider();
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
    const { provider } = makeProvider({}, backend);
    const result = await provider.execute(makeAction({ op: "click", selector: "#submit-btn" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("evil.com");
    expect(result.error).toContain("not in the allowlist");
  });

  it("fill fails when action ends on a disallowed domain", async () => {
    const backend = new RedirectingMockBackend();
    backend.fillRedirectUrl = "https://evil.com/after-fill";
    const { provider } = makeProvider({}, backend);
    const result = await provider.execute(
      makeAction({ op: "fill", selector: "#email", value: "a@b.com" }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("evil.com");
    expect(result.error).toContain("not in the allowlist");
  });

  it("fill with missing value fails", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "fill", selector: "#email" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'selector' or 'value'");
  });

  it("snapshot returns success", async () => {
    const { provider } = makeProvider();
    await provider.execute(makeAction({ op: "navigate", url: "https://example.com/page" }));
    const result = await provider.execute(makeAction({ op: "snapshot" }));

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "snapshot" });
  });

  it("snapshot fails when current page domain is disallowed", async () => {
    const backend = new RedirectingMockBackend();
    backend.currentUrl = "https://evil.com/snap";
    const { provider } = makeProvider({}, backend);
    const result = await provider.execute(makeAction({ op: "snapshot" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("evil.com");
    expect(result.error).toContain("not in the allowlist");
  });

  it("unknown op returns error", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "nonexistent_op" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown Web operation: nonexistent_op");
  });

  it("missing op returns error", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({}));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing 'op' field");
  });

  it("navigate_back returns url and title", async () => {
    const { provider } = makeProvider();
    await provider.execute(makeAction({ op: "navigate", url: "https://example.com/a" }));
    const result = await provider.execute(makeAction({ op: "navigate_back" }));

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "navigate_back" });
    expect((result.evidence as Record<string, unknown>).url).toBeDefined();
  });

  it("navigate_back fails when domain is disallowed after going back", async () => {
    const backend = new RedirectingMockBackend();
    backend.currentUrl = "https://evil.com/back";
    backend.goBack = async () => {
      backend.calls.push({ method: "goBack", args: [] });
      return { url: backend.currentUrl, title: "Evil" };
    };
    const { provider } = makeProvider({ allowedDomains: ["example.com"] }, backend);
    const result = await provider.execute(makeAction({ op: "navigate_back" }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("evil.com");
  });

  it("fill_form alias routes to fill handler", async () => {
    const { provider } = makeProvider();
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
});
