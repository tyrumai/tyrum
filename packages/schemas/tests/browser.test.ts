import { describe, expect, it } from "vitest";
import { BrowserActionArgs } from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("BrowserActionArgs", () => {
  it("parses get (geolocation) with defaults", () => {
    const parsed = BrowserActionArgs.parse({ op: "get" });
    expect(parsed).toEqual({
      op: "get",
      enable_high_accuracy: false,
      timeout_ms: 30_000,
      maximum_age_ms: 0,
    });
  });

  it("parses capture_photo with defaults", () => {
    const parsed = BrowserActionArgs.parse({ op: "capture_photo" });
    expect(parsed.op).toBe("capture_photo");
    expect(parsed.format).toBe("jpeg");
    expect(parsed.quality).toBe(0.92);
  });

  it("parses record (microphone) with defaults", () => {
    const parsed = BrowserActionArgs.parse({ op: "record" });
    expect(parsed.op).toBe("record");
    expect(parsed.duration_ms).toBe(5_000);
  });

  it("rejects unknown operations", () => {
    expectRejects(BrowserActionArgs, { op: "camera.snap" });
  });
});
