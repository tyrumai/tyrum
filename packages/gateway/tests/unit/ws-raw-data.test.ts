import { describe, expect, it } from "vitest";
import { rawDataToUtf8 } from "../../src/ws/raw-data.js";

describe("rawDataToUtf8", () => {
  it("converts Buffers to UTF-8 strings", () => {
    expect(rawDataToUtf8(Buffer.from("hello", "utf-8"))).toBe("hello");
  });

  it("converts ArrayBuffers to UTF-8 strings", () => {
    const buf = Buffer.from("hello", "utf-8");
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    expect(rawDataToUtf8(ab)).toBe("hello");
  });

  it("converts fragmented Buffers to UTF-8 strings", () => {
    expect(rawDataToUtf8([Buffer.from("hel", "utf-8"), Buffer.from("lo", "utf-8")])).toBe("hello");
  });
});
