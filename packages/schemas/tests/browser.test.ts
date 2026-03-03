import { describe, expect, it } from "vitest";
import { BrowserActionArgs } from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("BrowserActionArgs", () => {
  it("parses geolocation.get with defaults", () => {
    const parsed = BrowserActionArgs.parse({ op: "geolocation.get" });
    expect(parsed).toEqual({
      op: "geolocation.get",
      enable_high_accuracy: false,
      timeout_ms: 30_000,
      maximum_age_ms: 0,
    });
  });

  it("parses camera.capture_photo with defaults", () => {
    const parsed = BrowserActionArgs.parse({ op: "camera.capture_photo" });
    expect(parsed.op).toBe("camera.capture_photo");
    expect(parsed.format).toBe("jpeg");
    expect(parsed.quality).toBe(0.92);
  });

  it("parses microphone.record with defaults", () => {
    const parsed = BrowserActionArgs.parse({ op: "microphone.record" });
    expect(parsed.op).toBe("microphone.record");
    expect(parsed.duration_ms).toBe(5_000);
  });

  it("rejects unknown operations", () => {
    expectRejects(BrowserActionArgs, { op: "camera.snap" });
  });
});
