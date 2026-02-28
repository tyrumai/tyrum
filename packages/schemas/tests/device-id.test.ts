import { describe, expect, it } from "vitest";
import { base32LowerNoPad, deviceIdFromSha256Digest } from "../src/index.js";

describe("device-id", () => {
  it("base32LowerNoPad encodes trailing bits when byte length is not a multiple of 5", () => {
    expect(base32LowerNoPad(new Uint8Array([0]))).toBe("aa");
  });

  it("base32LowerNoPad does not add an extra char when byte length is a multiple of 5", () => {
    expect(base32LowerNoPad(new Uint8Array([0, 0, 0, 0, 0]))).toBe("aaaaaaaa");
  });

  it("deviceIdFromSha256Digest prefixes with dev_", () => {
    expect(deviceIdFromSha256Digest(new Uint8Array([0, 0, 0, 0, 0]))).toBe("dev_aaaaaaaa");
  });
});

