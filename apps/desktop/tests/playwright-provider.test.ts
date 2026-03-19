import { describe, expect, it } from "vitest";
import type { ActionPrimitive } from "@tyrum/contracts";
import { PlaywrightProvider, type PlaywrightProviderConfig } from "@tyrum/desktop-node";
import { MockPlaywrightBackend } from "./test-utils/mock-playwright-backend.js";

function makeAction(args: Record<string, unknown>): ActionPrimitive {
  return { type: "Web", args };
}

function makeProvider(overrides: Partial<PlaywrightProviderConfig> = {}) {
  const backend = new MockPlaywrightBackend();
  const provider = new PlaywrightProvider(
    {
      allowedDomains: ["example.com", "trusted.org"],
      headless: true,
      domainRestricted: true,
      ...overrides,
    },
    backend,
  );
  return { backend, provider };
}

describe("PlaywrightProvider package export", () => {
  it("executes browser actions through the shared desktop-node package", async () => {
    const { backend, provider } = makeProvider();

    const result = await provider.execute(
      makeAction({ op: "navigate", url: "https://example.com/page" }),
    );

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "navigate",
      url: "https://example.com/page",
    });
    expect(backend.calls).toContainEqual(
      expect.objectContaining({
        method: "navigate",
        args: ["https://example.com/page"],
      }),
    );
  });

  it("keeps allowlist enforcement in the app test harness", async () => {
    const { provider } = makeProvider();

    const result = await provider.execute(
      makeAction({ op: "navigate", url: "https://evil.com/steal" }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("evil.com");
    expect(result.error).toContain("not in the allowlist");
  });

  it("surfaces the shared browser capability ids", () => {
    const { provider } = makeProvider();

    expect(provider.capabilityIds).toContain("tyrum.browser.launch");
    expect(provider.capabilityIds).toContain("tyrum.browser.run-code");
    expect(provider.capabilityIds).toHaveLength(22);
  });
});
