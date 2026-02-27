import { describe, expect, it } from "vitest";
import { toOperatorCoreError } from "../src/operator-error.js";

describe("toOperatorCoreError", () => {
  it("parses ws-style 'op failed: CODE: msg' errors", () => {
    const error = new Error("connect failed: ECONNREFUSED: connection refused");

    const result = toOperatorCoreError("ws", "ignored", error);

    expect(result).toEqual({
      kind: "ws",
      operation: "connect",
      code: "ECONNREFUSED",
      message: "connection refused",
    });
  });

  it("maps '<operation> timed out' to a timeout code", () => {
    const result = toOperatorCoreError("http", "fetch", new Error("fetch timed out"));

    expect(result).toEqual({
      kind: "http",
      operation: "fetch",
      code: "timeout",
      message: "timed out",
    });
  });

  it("stringifies non-Error inputs when falling back", () => {
    const result = toOperatorCoreError("unknown", "op", 123);

    expect(result).toEqual({
      kind: "unknown",
      operation: "op",
      code: null,
      message: "123",
    });
  });
});
