import { describe, expect, it } from "vitest";
import { AgentMcpConfig, AgentSkillConfig, AgentToolConfig } from "../src/agent-access.js";

describe("agent access config normalization", () => {
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
});
