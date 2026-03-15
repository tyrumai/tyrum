import { describe, expect, it } from "vitest";
import type { ToolDescriptor } from "../../src/modules/agent/tools.js";
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
  it("returns copied allowlist and plugin tool arrays", async () => {
    const allowlist = ["read"];
    const pluginTools = [SIDE_EFFECTING_PLUGIN_TOOL, READ_ONLY_PLUGIN_TOOL];
    const result = await resolvePolicyGatedPluginToolExposure({
      allowlist,
      pluginTools,
    });

    expect(result.allowlist).toEqual(["read"]);
    expect(result.pluginTools.map((tool) => tool.id)).toEqual([
      "plugin.echo.danger",
      "plugin.echo.readonly",
    ]);
    expect(result.allowlist).not.toBe(allowlist);
    expect(result.pluginTools).not.toBe(pluginTools);
  });
});
