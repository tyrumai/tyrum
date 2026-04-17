import { resolveToolTaxonomyMetadata } from "@tyrum/contracts";
import { describe, expect, it } from "vitest";
import {
  buildSecretClipboardToolDescriptor,
  SECRET_CLIPBOARD_TOOL_ID,
} from "../../src/modules/agent/tool-secret-definitions.js";
import { listBuiltinToolDescriptors, type ToolDescriptor } from "../../src/modules/agent/tools.js";

const STANDALONE_CANONICAL_PUBLIC_IDS = new Set([
  "read",
  "write",
  "edit",
  "apply_patch",
  "glob",
  "grep",
  "bash",
  "websearch",
  "webfetch",
  "codesearch",
]);
const STRUCTURED_PUBLIC_SEGMENT = /^[a-z][a-z0-9-]*$/;
const RAW_MCP_SERVER_SEGMENT = /^[a-z][a-z0-9-]*$/;
const RAW_MCP_TOOL_SEGMENT = /^[a-z][a-z0-9_-]*$/;
const RESERVED_PLUGIN_PREFIXES = [
  "tool.",
  "memory.",
  "sandbox.",
  "subagent.",
  "workboard.",
  "mcp.",
];
const RESERVED_PLUGIN_EXACT_IDS = new Set([
  ...STANDALONE_CANONICAL_PUBLIC_IDS,
  "artifact.describe",
]);

function listShippedBuiltinDescriptors(): ToolDescriptor[] {
  const secretClipboardDescriptor = buildSecretClipboardToolDescriptor([
    {
      secret_ref_id: "secret-ref-1",
      secret_alias: "desktop-login",
      allowed_tool_ids: [SECRET_CLIPBOARD_TOOL_ID],
    },
  ]);

  if (!secretClipboardDescriptor) {
    throw new Error("expected secret clipboard descriptor");
  }

  return [...listBuiltinToolDescriptors(), secretClipboardDescriptor];
}

function expectCanonicalPublicToolIdGrammar(toolId: string): void {
  if (STANDALONE_CANONICAL_PUBLIC_IDS.has(toolId)) {
    return;
  }

  if (toolId.startsWith("mcp.")) {
    const segments = toolId.split(".");
    expect(segments).toHaveLength(3);
    expect(segments[0]).toBe("mcp");
    expect(segments[1]).toMatch(RAW_MCP_SERVER_SEGMENT);
    expect(segments[2]).toMatch(RAW_MCP_TOOL_SEGMENT);
    return;
  }

  const segments = toolId.split(".");
  expect(segments.length).toBeGreaterThan(1);
  for (const segment of segments) {
    expect(segment).toMatch(STRUCTURED_PUBLIC_SEGMENT);
  }
}

function pluginClaimsReservedPlatformId(toolId: string): boolean {
  return (
    RESERVED_PLUGIN_EXACT_IDS.has(toolId) ||
    RESERVED_PLUGIN_PREFIXES.some((prefix) => toolId.startsWith(prefix))
  );
}

describe("public tool taxonomy conformance", () => {
  it("keeps every shipped builtin descriptor on a canonical public taxonomy surface", () => {
    for (const descriptor of listShippedBuiltinDescriptors()) {
      expect(descriptor.taxonomy).toMatchObject({
        canonicalId: descriptor.id,
        lifecycle: "canonical",
        visibility: "public",
      });
      expect(descriptor.taxonomy?.family).toBeTruthy();
      expect(descriptor.taxonomy?.group).toBeTruthy();
      expect(descriptor.taxonomy?.tier).toBeTruthy();
      expectCanonicalPublicToolIdGrammar(descriptor.id);
    }
  });

  it("keeps built-in MCP facades on the canonical retrieval surface", () => {
    const builtinMcpDescriptors = listShippedBuiltinDescriptors().filter(
      (descriptor) => descriptor.source === "builtin_mcp",
    );

    expect(builtinMcpDescriptors.map((descriptor) => descriptor.id).toSorted()).toEqual([
      "codesearch",
      "webfetch",
      "websearch",
    ]);
    for (const descriptor of builtinMcpDescriptors) {
      expect(descriptor.taxonomy).toMatchObject({
        canonicalId: descriptor.id,
        family: "web",
        group: "retrieval",
        tier: "default",
        visibility: "public",
      });
    }
  });

  it("documents representative raw MCP and plugin namespace guardrails", () => {
    expect(
      resolveToolTaxonomyMetadata({
        toolId: "mcp.calendar.events_list",
        source: "mcp",
        family: "mcp",
      }),
    ).toMatchObject({
      canonicalId: "mcp.calendar.events_list",
      lifecycle: "canonical",
      visibility: "public",
      group: "extension",
      tier: "advanced",
    });
    expectCanonicalPublicToolIdGrammar("mcp.calendar.events_list");

    for (const toolId of ["plugin.echo.say", "custom.plugin.echo"]) {
      expect(pluginClaimsReservedPlatformId(toolId)).toBe(false);
      expect(
        resolveToolTaxonomyMetadata({
          toolId,
          source: "plugin",
          family: "plugin",
        }),
      ).toMatchObject({
        canonicalId: toolId,
        lifecycle: "canonical",
        visibility: "public",
        group: "extension",
        tier: "advanced",
      });
      expectCanonicalPublicToolIdGrammar(toolId);
    }

    for (const toolId of [
      "tool.browser.navigate",
      "memory.write",
      "sandbox.current",
      "subagent.spawn",
      "workboard.capture",
      "mcp.calendar.events_list",
      "read",
      "bash",
      "webfetch",
      "artifact.describe",
    ]) {
      expect(pluginClaimsReservedPlatformId(toolId)).toBe(true);
    }
  });
});
