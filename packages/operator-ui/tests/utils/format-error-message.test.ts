import { describe, expect, it } from "vitest";
import { formatErrorMessage } from "../../src/utils/format-error-message.js";

describe("formatErrorMessage", () => {
  it("prefers a non-empty Error.message", () => {
    expect(formatErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("falls back to String(error) when Error.message is blank", () => {
    const err = new Error("");
    expect(formatErrorMessage(err)).toBe(String(err));
  });

  it("formats non-Error values via String()", () => {
    expect(formatErrorMessage("nope")).toBe("nope");
  });
});
