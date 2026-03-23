import { describe, expect, it } from "vitest";
import { isUtilityHostInvocation, UTILITY_HOST_FLAG } from "../src/main/utility-host-flag.js";

describe("utility host flag", () => {
  it("matches the shared utility-host flag from argv", () => {
    expect(isUtilityHostInvocation(["electron", "bootstrap", UTILITY_HOST_FLAG])).toBe(true);
  });

  it("does not match other argv shapes", () => {
    expect(isUtilityHostInvocation(["electron", "bootstrap"])).toBe(false);
    expect(isUtilityHostInvocation(["electron", "bootstrap", "--other-flag"])).toBe(false);
  });
});
