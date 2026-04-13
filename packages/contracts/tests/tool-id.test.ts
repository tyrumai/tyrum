import { describe, expect, it } from "vitest";
import {
  canonicalizeExactToolIdList,
  canonicalizeToolId,
  canonicalizeToolIdList,
  normalizeStringIdList,
} from "../src/tool-id.js";
import { resolveToolTaxonomyMetadata } from "../src/tool-taxonomy.js";

describe("tool id canonicalization", () => {
  it("maps legacy tool ids to canonical ids", () => {
    expect(canonicalizeToolId("tool.fs.read")).toBe("read");
    expect(canonicalizeToolId("tool.fs.write")).toBe("write");
    expect(canonicalizeToolId("tool.exec")).toBe("bash");
    expect(canonicalizeToolId("tool.http.fetch")).toBe("webfetch");
    expect(canonicalizeToolId("mcp.memory.seed")).toBe("memory.seed");
    expect(canonicalizeToolId("mcp.memory.search")).toBe("memory.search");
    expect(canonicalizeToolId("mcp.memory.write")).toBe("memory.write");
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
      canonicalizeExactToolIdList([
        " tool.fs.read ",
        "read",
        "tool.exec",
        " bash ",
        "mcp.memory.write",
        "memory.write",
        "   ",
      ]),
    ).toEqual(["read", "bash", "memory.write"]);
  });

  it("resolves deterministic taxonomy metadata for canonical and legacy ids", () => {
    expect(resolveToolTaxonomyMetadata({ toolId: "read" })).toMatchObject({
      canonicalId: "read",
      lifecycle: "canonical",
      visibility: "public",
      family: "filesystem",
      group: "core",
      tier: "default",
    });

    expect(resolveToolTaxonomyMetadata({ toolId: "tool.fs.read" })).toMatchObject({
      canonicalId: "read",
      lifecycle: "alias",
      visibility: "runtime_only",
      family: "filesystem",
      group: "core",
      tier: "default",
    });

    expect(resolveToolTaxonomyMetadata({ toolId: "mcp.memory.seed", source: "mcp" })).toMatchObject(
      {
        canonicalId: "memory.seed",
        lifecycle: "deprecated",
        visibility: "public",
        family: "memory",
        group: "memory",
        tier: "default",
      },
    );
  });

  it("classifies extension and runtime-only tool ids for shared descriptor metadata", () => {
    expect(
      resolveToolTaxonomyMetadata({ toolId: "plugin.echo.say", source: "plugin" }),
    ).toMatchObject({
      canonicalId: "plugin.echo.say",
      lifecycle: "canonical",
      visibility: "public",
      family: "plugin",
      group: "extension",
      tier: "advanced",
    });

    expect(resolveToolTaxonomyMetadata({ toolId: "guardian_review_decision" })).toMatchObject({
      canonicalId: "guardian_review_decision",
      lifecycle: "canonical",
      visibility: "runtime_only",
      group: null,
      tier: null,
    });
  });
});
