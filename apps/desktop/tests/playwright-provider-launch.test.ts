import { describe, expect, it } from "vitest";
import type { ActionPrimitive } from "@tyrum/schemas";
import { PlaywrightProvider } from "@tyrum/desktop-node";
import { MockPlaywrightBackend } from "./test-utils/mock-playwright-backend.js";

function makeAction(args: Record<string, unknown>): ActionPrimitive {
  return { type: "Web", args };
}

describe("PlaywrightProvider launch", () => {
  it("routes launch through the backend", async () => {
    const backend = new MockPlaywrightBackend();
    const provider = new PlaywrightProvider(
      { allowedDomains: ["example.com"], headless: true, domainRestricted: true },
      backend,
    );

    const result = await provider.execute(makeAction({ op: "launch" }));

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ headless: true, browser: "chromium" });
    expect(backend.calls[0]).toMatchObject({ method: "launch", args: [{ headless: true }] });
  });
});
