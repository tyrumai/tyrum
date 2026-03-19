import { describe, expect, it } from "vitest";
import type { ActionPrimitive } from "@tyrum/schemas";
import {
  PlaywrightProvider,
  type PlaywrightProviderConfig,
} from "../../src/providers/playwright-provider.js";
import { MockPlaywrightBackend } from "../test-utils/mock-playwright-backend.js";

function makeAction(args: Record<string, unknown>): ActionPrimitive {
  return { type: "Web", args };
}

function makeProvider(overrides: Partial<PlaywrightProviderConfig> = {}) {
  const config: PlaywrightProviderConfig = {
    allowedDomains: ["*"],
    headless: true,
    domainRestricted: false,
    ...overrides,
  };
  const backend = new MockPlaywrightBackend();
  return { provider: new PlaywrightProvider(config, backend), backend };
}

describe("PlaywrightProvider launch", () => {
  it("launch with default settings returns headless true", async () => {
    const { provider, backend } = makeProvider();
    const result = await provider.execute(makeAction({ op: "launch" }));

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ headless: true, browser: "chromium" });
    expect(backend.calls[0]).toMatchObject({ method: "launch", args: [{ headless: true }] });
  });

  it("launch ignores an explicit headless override and uses the configured value", async () => {
    const { provider, backend } = makeProvider();
    const result = await provider.execute(makeAction({ op: "launch", headless: false }));

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ headless: true, browser: "chromium" });
    expect(backend.calls[0]).toMatchObject({ method: "launch", args: [{ headless: true }] });
  });

  it("launch preserves a configured non-headless mode", async () => {
    const { provider, backend } = makeProvider({ headless: false });
    const result = await provider.execute(makeAction({ op: "launch", headless: true }));

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ headless: false, browser: "chromium" });
    expect(backend.calls[0]).toMatchObject({ method: "launch", args: [{ headless: false }] });
  });

  it("launch when browser already running closes and relaunches", async () => {
    const { provider, backend } = makeProvider();

    // First launch
    await provider.execute(makeAction({ op: "launch" }));
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0]).toMatchObject({ method: "launch" });

    // Second launch should still call backend.launch (which handles close + relaunch)
    const result = await provider.execute(makeAction({ op: "launch", headless: false }));
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ headless: true, browser: "chromium" });
    expect(backend.calls).toHaveLength(2);
    expect(backend.calls[1]).toMatchObject({ method: "launch", args: [{ headless: true }] });
  });

  it("capabilityIds includes tyrum.browser.launch", () => {
    const { provider } = makeProvider();
    expect(provider.capabilityIds).toContain("tyrum.browser.launch");
  });

  it("launch backend error is caught and returned as failure", async () => {
    const { provider, backend } = makeProvider();
    backend.launch = async () => {
      throw new Error("chromium not installed");
    };
    const result = await provider.execute(makeAction({ op: "launch" }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("chromium not installed");
  });
});
