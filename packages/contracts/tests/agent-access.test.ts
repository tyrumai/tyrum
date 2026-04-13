import { describe, expect, it } from "vitest";
import { AgentMcpConfig, AgentSkillConfig, AgentToolConfig } from "../src/agent-access.js";

describe("agent access config normalization", () => {
  it("accepts canonical MCP bundle/tier selectors", () => {
    const parsed = AgentMcpConfig.parse({
      bundle: " workspace-default ",
      tier: "advanced",
      pre_turn_tools: ["mcp.memory.seed"],
    });

    expect(parsed).toEqual({
      bundle: "workspace-default",
      tier: "advanced",
      default_mode: "allow",
      allow: [],
      deny: [],
      pre_turn_tools: ["memory.seed"],
      server_settings: {},
    });
  });

  it("normalizes legacy skill enabled lists into deny-by-default access config", () => {
    const parsed = AgentSkillConfig.parse({
      enabled: [" authoring ", "authoring"],
      workspace_trusted: false,
    });

    expect(parsed).toEqual({
      default_mode: "deny",
      allow: ["authoring"],
      deny: [],
      workspace_trusted: false,
    });
  });

  it("normalizes legacy MCP enabled lists into deny-by-default access config", () => {
    const parsed = AgentMcpConfig.parse({
      enabled: ["mcp.weather.forecast", " mcp.weather.forecast "],
    });

    expect(parsed).toEqual({
      default_mode: "deny",
      allow: ["mcp.weather.forecast"],
      deny: [],
      pre_turn_tools: [],
      server_settings: {},
    });
  });

  it("normalizes legacy tool allowlists and preserves non-wildcard default deny", () => {
    const parsed = AgentToolConfig.parse({
      allow: ["tool.fs.*", " tool.exec "],
    });

    expect(parsed).toEqual({
      default_mode: "deny",
      allow: ["read", "write", "edit", "apply_patch", "glob", "grep", "bash"],
      deny: [],
    });
  });

  it("preserves canonical tool bundle/tier selectors alongside legacy allowlists", () => {
    const parsed = AgentToolConfig.parse({
      bundle: " authoring-core ",
      tier: "default",
      allow: [" tool.exec "],
    });

    expect(parsed).toEqual({
      bundle: "authoring-core",
      tier: "default",
      default_mode: "deny",
      allow: ["bash"],
      deny: [],
    });
  });
});
