import { describe, expect, it } from "vitest";
import { sha256HexFromString, stableJsonStringify } from "@tyrum/runtime-policy";

describe("runtime-policy canonical json", () => {
  it("sorts object keys recursively including objects nested inside arrays", () => {
    expect(
      stableJsonStringify({
        b: 1,
        a: [{ d: 1, c: 2 }],
      }),
    ).toBe('{"a":[{"c":2,"d":1}],"b":1}');
  });

  it("serializes undefined as null", () => {
    expect(stableJsonStringify(undefined)).toBe("null");
  });

  it("produces deterministic sha256 digests", () => {
    const value = stableJsonStringify({ b: 1, a: 2 });
    expect(sha256HexFromString(value)).toBe(sha256HexFromString(value));
    expect(sha256HexFromString(value)).toHaveLength(64);
  });
});
