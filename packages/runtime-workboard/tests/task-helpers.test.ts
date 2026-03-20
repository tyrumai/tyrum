import { describe, expect, it } from "vitest";
import { isTerminalTaskState } from "../src/index.js";

describe("isTerminalTaskState", () => {
  it.each([
    ["completed", true],
    ["skipped", true],
    ["cancelled", true],
    ["failed", true],
    ["queued", false],
    ["leased", false],
    ["running", false],
    ["paused", false],
    [undefined, false],
  ] as const)("returns %s for %s", (status, expected) => {
    expect(isTerminalTaskState(status)).toBe(expected);
  });
});
