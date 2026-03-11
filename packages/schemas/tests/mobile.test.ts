import { describe, expect, it } from "vitest";
import {
  AndroidActionArgs,
  IosActionArgs,
  MobileActionArgs,
  MobileActionResult,
} from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("mobile action schemas", () => {
  it("parses location.get_current with defaults", () => {
    const parsed = MobileActionArgs.parse({ op: "location.get_current" });
    expect(parsed).toEqual({
      op: "location.get_current",
      enable_high_accuracy: false,
      timeout_ms: 30_000,
      maximum_age_ms: 0,
    });
  });

  it("parses camera.capture_photo with defaults", () => {
    const parsed = MobileActionArgs.parse({ op: "camera.capture_photo" });
    expect(parsed.op).toBe("camera.capture_photo");
    expect(parsed.format).toBe("jpeg");
    expect(parsed.quality).toBe(0.92);
  });

  it("parses audio.record_clip with defaults", () => {
    const parsed = MobileActionArgs.parse({ op: "audio.record_clip" });
    expect(parsed.op).toBe("audio.record_clip");
    expect(parsed.duration_ms).toBe(5_000);
  });

  it("aliases ios and android action args to the mobile schema", () => {
    expect(IosActionArgs.parse({ op: "location.get_current" }).op).toBe("location.get_current");
    expect(AndroidActionArgs.parse({ op: "audio.record_clip" }).op).toBe("audio.record_clip");
  });

  it("parses mobile action results", () => {
    expect(
      MobileActionResult.parse({
        op: "audio.record_clip",
        bytesBase64: "Zm9v",
        mime: "audio/webm",
        duration_ms: 5_000,
        timestamp: "2026-01-01T00:00:00.000Z",
      }).op,
    ).toBe("audio.record_clip");
  });

  it("rejects unknown operations", () => {
    expectRejects(MobileActionArgs, { op: "geolocation.get" });
  });
});
