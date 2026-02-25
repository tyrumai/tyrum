import { describe, expect, it } from "vitest";
import { safeDetail } from "../../src/utils/safe-detail.js";

describe("safeDetail", () => {
  it("returns trimmed message for Error and string inputs", () => {
    expect(safeDetail(new Error("  boom  "))).toBe("boom");
    expect(safeDetail("  boom  ")).toBe("boom");
  });

  it("caps detail at 512 characters", () => {
    const long = "a".repeat(600);
    expect(safeDetail(long)?.length).toBe(512);
  });
});
