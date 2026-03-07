import { describe, expect, it, vi } from "vitest";
import type { ToolDescriptor } from "../../src/modules/agent/tools.js";
import type { PolicyService } from "../../src/modules/policy/service.js";
import { resolvePolicyGatedPluginToolExposure } from "../../src/modules/agent/runtime/plugin-tool-policy.js";

const SIDE_EFFECTING_PLUGIN_TOOL: ToolDescriptor = {
  id: "plugin.echo.danger",
  description: "Perform a dangerous plugin action.",
  risk: "high",
  requires_confirmation: true,
  keywords: ["danger"],
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

const READ_ONLY_PLUGIN_TOOL: ToolDescriptor = {
  id: "plugin.echo.readonly",
  description: "Read plugin state.",
  risk: "low",
  requires_confirmation: false,
  keywords: ["read"],
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

describe("resolvePolicyGatedPluginToolExposure", () => {
  it("passes tenant and agent scope to the effective policy bundle lookup", async () => {
    const loadEffectiveBundle = vi.fn(async (_scope: { tenantId: string; agentId?: string }) => ({
      bundle: {
        v: 1,
        tools: {
          default: "deny" as const,
          allow: [],
          require_approval: ["plugin.echo.danger"],
          deny: [],
        },
      },
      sha256: "sha-1",
      sources: { deployment: "default", agent: null, playbook: null },
    }));
    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      loadEffectiveBundle,
    } as unknown as PolicyService;

    const result = await resolvePolicyGatedPluginToolExposure({
      policyService,
      tenantId: "tenant-a",
      agentId: "agent-a",
      allowlist: ["tool.fs.read"],
      pluginTools: [
        { ...SIDE_EFFECTING_PLUGIN_TOOL, id: " plugin.echo.danger " },
        READ_ONLY_PLUGIN_TOOL,
      ],
    });

    expect(loadEffectiveBundle).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      agentId: "agent-a",
    });
    expect(result.allowlist).toEqual(["tool.fs.read", "plugin.echo.danger"]);
    expect(result.pluginTools.map((tool) => tool.id)).toEqual([
      "plugin.echo.danger",
      "plugin.echo.readonly",
    ]);
  });

  it("does not load a scoped bundle when deployment policy is disabled", async () => {
    const loadEffectiveBundle = vi.fn();
    const policyService = {
      isEnabled: () => false,
      isObserveOnly: () => false,
      loadEffectiveBundle,
    } as unknown as PolicyService;

    const result = await resolvePolicyGatedPluginToolExposure({
      policyService,
      tenantId: "tenant-a",
      agentId: "agent-a",
      allowlist: ["plugin.echo.danger"],
      pluginTools: [{ ...SIDE_EFFECTING_PLUGIN_TOOL, id: " plugin.echo.danger " }],
    });

    expect(loadEffectiveBundle).not.toHaveBeenCalled();
    expect(result.allowlist).toEqual(["plugin.echo.danger"]);
    expect(result.pluginTools.map((tool) => tool.id)).toEqual(["plugin.echo.danger"]);
  });
});
