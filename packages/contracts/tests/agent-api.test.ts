import { describe, expect, it } from "vitest";
import { AgentConfigGetResponse, AgentStatusResponse, ManagedAgentDetail } from "../src/index.js";

describe("agent api read models", () => {
  it("parses additive canonical tool exposure on config, detail, and status reads", () => {
    const toolExposure = {
      mcp: { bundle: "workspace-default", tier: "advanced" },
      tools: { bundle: "authoring-core", tier: "default" },
    };

    const configResponse = AgentConfigGetResponse.parse({
      revision: 1,
      tenant_id: "tenant-1",
      agent_id: "11111111-1111-4111-8111-111111111111",
      agent_key: "default",
      config: { model: { model: "openai/gpt-5.4" } },
      tool_exposure: toolExposure,
      persona: {
        name: "Default",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
      config_sha256: "a".repeat(64),
      created_at: "2026-03-01T00:00:00.000Z",
      created_by: { kind: "test" },
      reason: null,
      reverted_from_revision: null,
    });
    const managedAgent = ManagedAgentDetail.parse({
      agent_id: "11111111-1111-4111-8111-111111111111",
      agent_key: "default",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
      has_config: true,
      has_identity: true,
      is_primary: true,
      can_delete: false,
      persona: {
        name: "Default",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
      config: { model: { model: "openai/gpt-5.4" } },
      tool_exposure: toolExposure,
      identity: { meta: { name: "Default", style: { tone: "direct" } } },
      config_revision: 1,
      identity_revision: 1,
      config_sha256: "a".repeat(64),
      identity_sha256: "b".repeat(64),
    });
    const status = AgentStatusResponse.parse({
      enabled: true,
      home: "/tmp/default",
      persona: {
        name: "Default",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
      identity: { name: "Default" },
      model: { model: "openai/gpt-5.4" },
      skills: [],
      mcp: [],
      tools: [],
      tool_exposure: toolExposure,
      tool_access: { default_mode: "allow", allow: [], deny: [] },
      conversations: { ttl_days: 365, max_turns: 0 },
    });

    expect(configResponse.tool_exposure).toEqual(toolExposure);
    expect(managedAgent.tool_exposure).toEqual(toolExposure);
    expect(status.tool_exposure).toEqual(toolExposure);
  });

  it("parses legacy read models when canonical selectors are unresolved", () => {
    const parsed = AgentStatusResponse.parse({
      enabled: false,
      home: "/tmp/default",
      persona: {
        name: "Default",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
      identity: { name: "Default" },
      model: { model: "disabled/disabled" },
      skills: [],
      mcp: [],
      tools: [],
      tool_exposure: { mcp: {}, tools: {} },
      tool_access: { default_mode: "deny", allow: ["read"], deny: [] },
      conversations: { ttl_days: 365, max_turns: 0 },
    });

    expect(parsed.tool_exposure).toEqual({ mcp: {}, tools: {} });
    expect(parsed.tool_access?.allow).toEqual(["read"]);
  });
});
