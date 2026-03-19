import { describe, expect, it } from "vitest";
import type { ActionPrimitive } from "@tyrum/contracts";
import { PlaywrightProvider } from "../src/providers/playwright-provider.js";
import type { PageSnapshot } from "../src/providers/backends/playwright-backend.js";
import { MockPlaywrightBackend } from "./test-utils/mock-playwright-backend.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWebAction(args: Record<string, unknown>, postcondition?: unknown): ActionPrimitive {
  return { type: "Web", args, postcondition };
}

/** Mock backend that returns configurable HTML for postcondition testing. */
class PostconditionMockBackend extends MockPlaywrightBackend {
  html = "<html><body>mock</body></html>";

  override async snapshot(): Promise<PageSnapshot> {
    this.calls.push({ method: "snapshot", args: [] });
    return { html: this.html, title: "Test", url: "https://example.com" };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Playwright postcondition evaluation", () => {
  it("evaluates dom_contains postcondition after navigate", async () => {
    const backend = new PostconditionMockBackend();
    backend.html = "<html><body><h1>Welcome</h1></body></html>";
    const provider = new PlaywrightProvider(
      { allowedDomains: ["example.com"], headless: true, domainRestricted: true },
      backend,
    );
    const result = await provider.execute(
      makeWebAction(
        { op: "navigate", url: "https://example.com" },
        { type: "dom_contains", text: "Welcome" },
      ),
    );
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect(evidence.postcondition).toBeDefined();
    const report = evidence.postcondition as { passed: boolean };
    expect(report.passed).toBe(true);
  });

  it("fails when dom_contains text is missing", async () => {
    const backend = new PostconditionMockBackend();
    backend.html = "<html><body><h1>Goodbye</h1></body></html>";
    const provider = new PlaywrightProvider(
      { allowedDomains: ["example.com"], headless: true, domainRestricted: true },
      backend,
    );
    const result = await provider.execute(
      makeWebAction(
        { op: "navigate", url: "https://example.com" },
        { type: "dom_contains", text: "Welcome" },
      ),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("postcondition failed");
  });

  it("evaluates postcondition after click", async () => {
    const backend = new PostconditionMockBackend();
    backend.html = "<html><body><div>Clicked</div></body></html>";
    const provider = new PlaywrightProvider(
      { allowedDomains: ["example.com"], headless: true, domainRestricted: true },
      backend,
    );
    const result = await provider.execute(
      makeWebAction({ op: "click", selector: "#btn" }, { type: "dom_contains", text: "Clicked" }),
    );
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    const report = evidence.postcondition as { passed: boolean };
    expect(report.passed).toBe(true);
  });

  it("evaluates postcondition after fill", async () => {
    const backend = new PostconditionMockBackend();
    backend.html = '<html><body><input value="filled" /></body></html>';
    const provider = new PlaywrightProvider(
      { allowedDomains: ["example.com"], headless: true, domainRestricted: true },
      backend,
    );
    const result = await provider.execute(
      makeWebAction(
        { op: "fill", selector: "#input", value: "test" },
        { type: "dom_contains", text: "filled" },
      ),
    );
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    const report = evidence.postcondition as { passed: boolean };
    expect(report.passed).toBe(true);
  });

  it("succeeds without postcondition (backwards compatible)", async () => {
    const backend = new MockPlaywrightBackend();
    const provider = new PlaywrightProvider(
      { allowedDomains: ["example.com"], headless: true, domainRestricted: true },
      backend,
    );
    const result = await provider.execute(
      makeWebAction({ op: "navigate", url: "https://example.com" }),
    );
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect(evidence.postcondition).toBeUndefined();
  });

  it("skips postcondition on snapshot (read-only)", async () => {
    const backend = new MockPlaywrightBackend();
    const provider = new PlaywrightProvider(
      { allowedDomains: [], headless: true, domainRestricted: false },
      backend,
    );
    const result = await provider.execute(
      makeWebAction({ op: "snapshot" }, { type: "dom_contains", text: "anything" }),
    );
    // Snapshot should succeed and NOT evaluate postcondition
    expect(result.success).toBe(true);
    const evidence = result.evidence as Record<string, unknown>;
    expect(evidence.postcondition).toBeUndefined();
  });
});
