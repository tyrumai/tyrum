import { describe, expect, it } from "vitest";
import {
  canonicalizeExactToolIdList,
  canonicalizeToolId,
  canonicalizeToolIdList,
  normalizeStringIdList,
} from "../src/tool-id.js";

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

  it("normalizes exact id lists without canonicalizing legacy aliases", () => {
    expect(normalizeStringIdList([" read ", "read", "tool.fs.read", " ", "tool.fs.read"])).toEqual([
      "read",
      "tool.fs.read",
    ]);
  });

  it("canonicalizes exact ids while trimming blanks and removing duplicates", () => {
    expect(
      canonicalizeExactToolIdList([" tool.fs.read ", "read", "tool.exec", " bash ", "   "]),
    ).toEqual(["read", "bash"]);
  });
});
