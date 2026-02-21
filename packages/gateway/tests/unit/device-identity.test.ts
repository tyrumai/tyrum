import { describe, expect, it } from "vitest";
import { verifyDeviceProof } from "../../src/ws/device-identity.js";

describe("verifyDeviceProof", () => {
  it("accepts non-empty proof", () => {
    expect(verifyDeviceProof("proof", "challenge")).toBe(true);
  });

  it("rejects empty proof", () => {
    expect(verifyDeviceProof("", "challenge")).toBe(false);
  });

  it("rejects empty challenge", () => {
    expect(verifyDeviceProof("proof", "")).toBe(false);
  });
});
