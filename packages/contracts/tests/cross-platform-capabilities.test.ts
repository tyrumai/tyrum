import { describe, expect, it } from "vitest";
import { AudioRecordArgs, CameraCapturePhotoArgs } from "../src/index.js";
import { expectRejects } from "./test-helpers.js";

describe("cross-platform sensor schemas", () => {
  it("parses canonical camera photo args with facing_mode", () => {
    const parsed = CameraCapturePhotoArgs.parse({ facing_mode: "user" });

    expect(parsed).toEqual({
      facing_mode: "user",
      format: "jpeg",
      quality: 0.92,
    });
  });

  it("rejects platform-specific camera photo fields in the shared schema", () => {
    expectRejects(CameraCapturePhotoArgs, { camera: "front" });
    expectRejects(CameraCapturePhotoArgs, { device_id: "camera-1" });
  });

  it("rejects browser-only device selection in shared audio args", () => {
    expect(AudioRecordArgs.parse({ mime: "audio/webm" })).toEqual({
      duration_ms: 5_000,
      mime: "audio/webm",
    });
    expectRejects(AudioRecordArgs, { device_id: "microphone-1" });
  });
});
