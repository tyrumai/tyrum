import { AgentConfig } from "@tyrum/contracts";
import { describe, expect, it } from "vitest";
import {
  resolveEffectiveToolExposureVerdicts,
  type EffectiveToolExposureVerdict,
} from "../../src/modules/agent/runtime/effective-exposure-resolver.js";
import {
  withResolvedToolDescriptorTaxonomy,
  type ToolDescriptor,
} from "../../src/modules/agent/tools.js";

function descriptor(tool: ToolDescriptor): ToolDescriptor {
  return withResolvedToolDescriptorTaxonomy(tool);
}

function buildAgentConfig(input?: Partial<AgentConfig>): AgentConfig {
  return AgentConfig.parse({
    model: { model: "openai/gpt-4.1" },
    tools: {
      default_mode: "deny",
      allow: [],
      deny: [],
      ...input?.tools,
    },
    mcp: {
      default_mode: "deny",
      allow: [],
      deny: [],
      ...input?.mcp,
    },
  });
}

function verdictById(
  verdicts: readonly EffectiveToolExposureVerdict[],
  toolId: string,
): EffectiveToolExposureVerdict {
  const verdict = verdicts.find((entry) => entry.descriptor.id === toolId);
  if (!verdict) {
    throw new Error(`missing verdict for ${toolId}`);
  }
  return verdict;
}

describe("effective exposure resolver", () => {
  it("applies canonical bundle and tier rules across builtin and MCP tool classes", () => {
    const candidates = [
      descriptor({
        id: "read",
        description: "Read a file.",
        effect: "read_only",
        keywords: ["read"],
      }),
      descriptor({
        id: "tool.desktop.snapshot",
        description: "Inspect the desktop.",
        effect: "read_only",
        keywords: ["desktop"],
      }),
      descriptor({
        id: "websearch",
        description: "Search the web.",
        effect: "read_only",
        keywords: ["web"],
        source: "builtin_mcp",
        family: "web",
      }),
      descriptor({
        id: "mcp.calendar.events_list",
        description: "List calendar events.",
        effect: "read_only",
        keywords: ["calendar"],
        source: "mcp",
      }),
      descriptor({
        id: "plugin.echo.readonly",
        description: "Read plugin data.",
        effect: "read_only",
        keywords: ["plugin"],
        source: "plugin",
      }),
    ];
    const config = buildAgentConfig({
      tools: {
        bundle: "authoring-core",
        tier: "default",
        default_mode: "allow",
        allow: [],
        deny: [],
      },
      mcp: {
        bundle: "workspace-default",
        tier: "advanced",
        default_mode: "allow",
        allow: [],
        deny: [],
      },
    });

    const verdicts = resolveEffectiveToolExposureVerdicts({
      candidates,
      toolConfig: config.tools,
      mcpConfig: config.mcp,
    });

    expect(verdictById(verdicts, "read")).toMatchObject({
      enabledByAgent: true,
      enabled: true,
      reason: "enabled",
      exposureClass: "builtin",
    });
    expect(verdictById(verdicts, "websearch")).toMatchObject({
      enabledByAgent: true,
      enabled: true,
      reason: "enabled",
      exposureClass: "builtin_mcp",
    });
    expect(verdictById(verdicts, "tool.desktop.snapshot")).toMatchObject({
      enabledByAgent: false,
      enabled: false,
      reason: "disabled_by_agent_tier",
      exposureClass: "builtin",
    });
    expect(verdictById(verdicts, "mcp.calendar.events_list")).toMatchObject({
      enabledByAgent: true,
      enabled: true,
      reason: "enabled",
      exposureClass: "mcp",
    });
    expect(verdictById(verdicts, "plugin.echo.readonly")).toMatchObject({
      enabledByAgent: false,
      enabled: false,
      reason: "disabled_by_plugin_opt_in",
      exposureClass: "plugin",
    });
  });

  it("applies execution-profile gating after agent exposure selection", () => {
    const candidates = [
      descriptor({
        id: "read",
        description: "Read a file.",
        effect: "read_only",
        keywords: ["read"],
      }),
      descriptor({
        id: "websearch",
        description: "Search the web.",
        effect: "read_only",
        keywords: ["web"],
        source: "builtin_mcp",
        family: "web",
      }),
    ];
    const config = buildAgentConfig({
      tools: {
        default_mode: "allow",
        allow: [],
        deny: [],
      },
    });

    const verdicts = resolveEffectiveToolExposureVerdicts({
      candidates,
      toolConfig: config.tools,
      mcpConfig: config.mcp,
      executionProfile: {
        allowlist: ["websearch"],
        denylist: [],
      },
    });

    expect(verdictById(verdicts, "read")).toMatchObject({
      enabledByAgent: true,
      enabled: false,
      reason: "disabled_by_execution_profile",
    });
    expect(verdictById(verdicts, "websearch")).toMatchObject({
      enabledByAgent: true,
      enabled: true,
      reason: "enabled",
    });
  });

  it("applies state-mode gating after agent selection for builtin tools", () => {
    const candidates = [
      descriptor({
        id: "read",
        description: "Read a file.",
        effect: "read_only",
        keywords: ["read"],
      }),
    ];
    const config = buildAgentConfig({
      tools: {
        default_mode: "allow",
        allow: [],
        deny: [],
      },
    });

    const verdicts = resolveEffectiveToolExposureVerdicts({
      candidates,
      toolConfig: config.tools,
      mcpConfig: config.mcp,
      stateMode: "shared",
    });

    expect(verdictById(verdicts, "read")).toMatchObject({
      enabledByAgent: true,
      enabled: false,
      reason: "disabled_by_state_mode",
    });
  });

  it("marks invalid schemas as disabled without changing agent selection", () => {
    const candidates = [
      descriptor({
        id: "plugin.echo.invalid",
        description: "Invalid plugin schema.",
        effect: "read_only",
        keywords: ["plugin"],
        source: "plugin",
      }),
    ];
    const config = buildAgentConfig({
      tools: {
        default_mode: "deny",
        allow: ["plugin.echo.invalid"],
        deny: [],
      },
    });

    const verdicts = resolveEffectiveToolExposureVerdicts({
      candidates,
      toolConfig: config.tools,
      mcpConfig: config.mcp,
      invalidSchemaToolIds: ["plugin.echo.invalid"],
      pluginPolicyAllowedToolIds: ["plugin.echo.invalid"],
    });

    expect(verdictById(verdicts, "plugin.echo.invalid")).toMatchObject({
      enabledByAgent: true,
      enabled: false,
      reason: "disabled_invalid_schema",
    });
  });

  it("keeps plugin policy as an explicit post-opt-in input", () => {
    const candidates = [
      descriptor({
        id: "plugin.echo.readonly",
        description: "Read plugin data.",
        effect: "read_only",
        keywords: ["plugin"],
        source: "plugin",
      }),
    ];
    const config = buildAgentConfig({
      tools: {
        default_mode: "deny",
        allow: ["plugin.echo.readonly"],
        deny: [],
      },
    });

    const allowedVerdicts = resolveEffectiveToolExposureVerdicts({
      candidates,
      toolConfig: config.tools,
      mcpConfig: config.mcp,
      pluginPolicyAllowedToolIds: ["plugin.echo.readonly"],
    });
    const deniedVerdicts = resolveEffectiveToolExposureVerdicts({
      candidates,
      toolConfig: config.tools,
      mcpConfig: config.mcp,
      pluginPolicyAllowedToolIds: [],
    });

    expect(verdictById(allowedVerdicts, "plugin.echo.readonly")).toMatchObject({
      enabledByAgent: true,
      enabled: true,
      reason: "enabled",
    });
    expect(verdictById(deniedVerdicts, "plugin.echo.readonly")).toMatchObject({
      enabledByAgent: false,
      enabled: false,
      reason: "disabled_by_plugin_policy",
    });
  });

  it("treats source-less plugin-prefixed ids as plugin tools", () => {
    const candidates = [
      descriptor({
        id: "plugin.echo.readonly",
        description: "Read plugin data.",
        effect: "read_only",
        keywords: ["plugin"],
      }),
    ];
    const config = buildAgentConfig({
      tools: {
        default_mode: "deny",
        allow: ["plugin.echo.readonly"],
        deny: [],
      },
    });

    const verdicts = resolveEffectiveToolExposureVerdicts({
      candidates,
      toolConfig: config.tools,
      mcpConfig: config.mcp,
      pluginPolicyAllowedToolIds: ["plugin.echo.readonly"],
    });

    expect(verdictById(verdicts, "plugin.echo.readonly")).toMatchObject({
      exposureClass: "plugin",
      enabledByAgent: true,
      enabled: true,
      reason: "enabled",
    });
  });

  it("does not override an explicit non-plugin source with a plugin-prefixed id", () => {
    const candidates = [
      descriptor({
        id: "plugin.calendar.proxy",
        description: "Proxy calendar tool.",
        effect: "read_only",
        keywords: ["calendar"],
        source: "mcp",
        family: "mcp",
      }),
    ];
    const config = buildAgentConfig({
      mcp: {
        bundle: "workspace-default",
        tier: "advanced",
        default_mode: "allow",
        allow: [],
        deny: [],
      },
      tools: {
        bundle: "authoring-core",
        tier: "default",
        default_mode: "deny",
        allow: [],
        deny: [],
      },
    });

    const verdicts = resolveEffectiveToolExposureVerdicts({
      candidates,
      toolConfig: config.tools,
      mcpConfig: config.mcp,
    });

    expect(verdictById(verdicts, "plugin.calendar.proxy")).toMatchObject({
      exposureClass: "mcp",
      enabledByAgent: true,
      enabled: true,
      reason: "enabled",
    });
  });
});
