import { describe, expect, it } from "vitest";
import { canonicalizeToolId, canonicalizeToolIdList } from "../src/index.js";

describe("tool id canonicalization", () => {
  it("maps legacy tool ids to canonical ids", () => {
    expect(canonicalizeToolId("tool.fs.read")).toBe("read");
    expect(canonicalizeToolId("tool.fs.write")).toBe("write");
    expect(canonicalizeToolId("tool.exec")).toBe("bash");
    expect(canonicalizeToolId("tool.http.fetch")).toBe("webfetch");
  });

  it("expands legacy fs wildcards to the canonical builtin set", () => {
    expect(canonicalizeToolIdList(["tool.fs.*"])).toEqual([
      "read",
      "write",
      "edit",
      "apply_patch",
      "glob",
      "grep",
    ]);
  });

  it("expands legacy global tool wildcards to any canonical tool", () => {
    expect(canonicalizeToolIdList(["tool.*"])).toEqual(["*"]);
  });
});
