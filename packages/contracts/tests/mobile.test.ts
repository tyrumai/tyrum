import { describe, expect, it } from "vitest";
import {
  AndroidActionArgs,
  IosActionArgs,
  MobileActionArgs,
  MobileActionResult,
} from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("mobile action schemas", () => {
  it("parses get (location) with defaults", () => {
    const parsed = MobileActionArgs.parse({ op: "get" });
    expect(parsed).toEqual({
      op: "get",
      enable_high_accuracy: false,
      timeout_ms: 30_000,
      maximum_age_ms: 0,
    });
  });

  it("parses capture_photo with defaults", () => {
    const parsed = MobileActionArgs.parse({ op: "capture_photo" });
    expect(parsed.op).toBe("capture_photo");
    expect(parsed.format).toBe("jpeg");
    expect(parsed.quality).toBe(0.92);
  });

  it("parses record (audio) with defaults", () => {
    const parsed = MobileActionArgs.parse({ op: "record" });
    expect(parsed.op).toBe("record");
    expect(parsed.duration_ms).toBe(5_000);
  });

  it("aliases ios and android action args to the mobile schema", () => {
    expect(IosActionArgs.parse({ op: "get" }).op).toBe("get");
    expect(AndroidActionArgs.parse({ op: "record" }).op).toBe("record");
  });

  it("parses mobile action results", () => {
    expect(
      MobileActionResult.parse({
        op: "record",
        bytesBase64: "Zm9v",
        mime: "audio/webm",
        duration_ms: 5_000,
        timestamp: "2026-01-01T00:00:00.000Z",
      }).op,
    ).toBe("record");
  });

  it("rejects unknown operations", () => {
    expectRejects(MobileActionArgs, { op: "geolocation.get" });
  });
});
