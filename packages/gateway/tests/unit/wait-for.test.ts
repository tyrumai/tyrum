/**
 * waitForCondition tests — shared helper for readiness-based waits in tests.
 */

import { describe, expect, it } from "vitest";
import { waitForCondition } from "../helpers/wait-for.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("waitForCondition", () => {
  it("resolves once the condition becomes true", async () => {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 10);

    await waitForCondition(() => ready, {
      timeoutMs: 1_000,
      intervalMs: 10,
      description: "ready flag",
    });
  });

  it("keeps polling when the condition throws transiently", async () => {
    let calls = 0;
    await waitForCondition(
      () => {
        calls += 1;
        if (calls < 3) throw new Error("not yet");
        return true;
      },
      { timeoutMs: 1_000, intervalMs: 10, description: "transient condition" },
    );

    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it("throws a useful error on timeout (with debug info)", async () => {
    let thrown: unknown;
    try {
      await waitForCondition(() => false, {
        timeoutMs: 25,
        intervalMs: 5,
        description: "never becomes true",
        debug: async () => "debug-state",
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("never becomes true");
    expect((thrown as Error).message).toContain("debug-state");
  });
});
