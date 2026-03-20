import { describe, expect, it } from "vitest";
import { makeAction, makeProvider } from "../test-utils/playwright-provider-fixture.js";

describe("PlaywrightProvider introspection", () => {
  it("tabs returns tab list", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "tabs" }));

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({
      type: "tabs",
      active_index: 0,
    });
    expect((result.evidence as Record<string, unknown>).tabs).toBeDefined();
  });

  it("console_messages returns messages array", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "console_messages" }));

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "console_messages" });
    expect((result.evidence as Record<string, unknown>).messages).toEqual([]);
  });

  it("network_requests returns requests array", async () => {
    const { provider } = makeProvider();
    const result = await provider.execute(makeAction({ op: "network_requests" }));

    expect(result.success).toBe(true);
    expect(result.evidence).toMatchObject({ type: "network_requests" });
    expect((result.evidence as Record<string, unknown>).requests).toEqual([]);
  });

  it("capabilityIds lists all 22 browser operations", () => {
    const { provider } = makeProvider();

    expect(provider.capabilityIds).toContain("tyrum.browser.launch");
    expect(provider.capabilityIds).toContain("tyrum.browser.navigate");
    expect(provider.capabilityIds).toContain("tyrum.browser.close");
    expect(provider.capabilityIds).toContain("tyrum.browser.run-code");
    expect(provider.capabilityIds).toHaveLength(22);
  });
});
