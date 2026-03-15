import { describe, expect, it, vi } from "vitest";
import type { ToolDescriptor } from "../../src/modules/agent/tools.js";
import type { PolicyService } from "../../src/modules/policy/service.js";
import { resolvePolicyGatedPluginToolExposure } from "../../src/modules/agent/runtime/plugin-tool-policy.js";

const SIDE_EFFECTING_PLUGIN_TOOL: ToolDescriptor = {
  id: "plugin.echo.danger",
  description: "Perform a dangerous plugin action.",
  effect: "state_changing",
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
  effect: "read_only",
  keywords: ["read"],
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
};

describe("resolvePolicyGatedPluginToolExposure", () => {
  it("normalizes plugin tool ids without consulting policy state", async () => {
    const loadEffectiveBundle = vi.fn();
    const policyService = {
      isEnabled: () => true,
      isObserveOnly: () => false,
      loadEffectiveBundle,
    } as unknown as PolicyService;

    const result = await resolvePolicyGatedPluginToolExposure({
      policyService,
      tenantId: "tenant-a",
      agentId: "agent-a",
      allowlist: ["read"],
      pluginTools: [
        { ...SIDE_EFFECTING_PLUGIN_TOOL, id: " plugin.echo.danger " },
        READ_ONLY_PLUGIN_TOOL,
      ],
    });

    expect(loadEffectiveBundle).not.toHaveBeenCalled();
    expect(result.allowlist).toEqual(["read"]);
    expect(result.pluginTools.map((tool) => tool.id)).toEqual([
      "plugin.echo.danger",
      "plugin.echo.readonly",
    ]);
  });

  it("returns the normalized allowlist and plugin tools when policy is disabled", async () => {
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
