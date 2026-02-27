import { describe, expect, it } from "vitest";
import { toOperatorCoreError } from "../src/operator-error.js";

describe("toOperatorCoreError", () => {
  it("parses ws-style '<op> failed: <code>: <message>' errors", () => {
    expect(
      toOperatorCoreError(
        "ws",
        "memory.list",
        new Error("memory.search failed: unsupported_request: no db"),
      ),
    ).toEqual({
      kind: "ws",
      operation: "memory.search",
      code: "unsupported_request",
      message: "no db",
    });
  });

  it("maps '<operation> timed out' errors to code=timeout", () => {
    expect(toOperatorCoreError("http", "runs.list", new Error("runs.list timed out"))).toEqual({
      kind: "http",
      operation: "runs.list",
      code: "timeout",
      message: "timed out",
    });
  });

  it("falls back to stringifying unknown errors", () => {
    expect(toOperatorCoreError("unknown", "runs.list", "boom")).toEqual({
      kind: "unknown",
      operation: "runs.list",
      code: null,
      message: "boom",
    });
  });
});

