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

  it("caps Error detail at 512 characters", () => {
    const long = "e".repeat(600);
    expect(safeDetail(new Error(long))?.length).toBe(512);
  });

  it("returns undefined for Error with empty message", () => {
    expect(safeDetail(new Error(""))).toBeUndefined();
  });

  it("returns undefined for Error with whitespace-only message", () => {
    expect(safeDetail(new Error("   "))).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(safeDetail("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(safeDetail("   ")).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(safeDetail(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(safeDetail(undefined)).toBeUndefined();
  });

  it("returns undefined for non-Error objects", () => {
    expect(safeDetail({ message: "not an Error" })).toBeUndefined();
  });

  it("returns undefined for numbers", () => {
    expect(safeDetail(42)).toBeUndefined();
  });
});
