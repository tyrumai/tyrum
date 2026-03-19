import { describe, expect, it } from "vitest";
import { AgentConfig } from "@tyrum/contracts";
import { countAssignments } from "../../src/modules/extensions/catalog.js";

function createConfig(input?: {
  skills?: Partial<AgentConfig["skills"]>;
  mcp?: Partial<AgentConfig["mcp"]>;
}): AgentConfig {
  return AgentConfig.parse({
    model: { model: "openai/gpt-4.1" },
    ...input,
  });
}

describe("countAssignments", () => {
  it("does not treat default-allow extension access as an explicit assignment", () => {
    const configs = [createConfig(), createConfig({ skills: { default_mode: "allow", deny: [] } })];

    expect(countAssignments(configs, "skill", "managed-skill")).toBe(0);
  });

  it("counts explicit wildcard assignments for managed extensions", () => {
    const configs = [
      createConfig({ skills: { default_mode: "allow", allow: ["managed-*"], deny: [] } }),
      createConfig({ skills: { default_mode: "deny", allow: ["managed-skill"], deny: [] } }),
    ];

    expect(countAssignments(configs, "skill", "managed-skill")).toBe(2);
  });

  it("does not count default-allow MCP access without an explicit allow entry", () => {
    const configs = [createConfig({ mcp: { default_mode: "allow", deny: ["other-server"] } })];

    expect(countAssignments(configs, "mcp", "calendar")).toBe(0);
  });
});
