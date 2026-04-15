import { expect, it, vi } from "vitest";
import type { RequestInit } from "undici";
import {
  createTestClient,
  jsonResponse,
  makeFetchMock,
  mockJsonFetch,
} from "./http-client.test-support.js";

export function registerHttpClientAgentExposureTests(): void {
  it("agentStatus.get sends GET /agent/status with persona data", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        enabled: true,
        home: "/tmp/agent-1",
        persona: {
          name: "Hypatia",
          tone: "direct",
          palette: "graphite",
          character: "architect",
        },
        identity: {
          name: "Hypatia",
        },
        model: { model: "openai/gpt-4.1" },
        skills: [],
        mcp: [],
        tools: [],
        tool_exposure: {
          mcp: {},
          tools: {},
        },
        conversations: { ttl_days: 30, max_turns: 20 },
      }),
    );
    const client = createTestClient({ fetch });

    const result = await client.agentStatus.get({ agent_key: "agent-1" });
    expect(result.persona.name).toBe("Hypatia");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/agent/status?agent_key=agent-1");
    expect(init.method).toBe("GET");
  });

  it("agentConfig reads and updates canonical tool exposure config through /config/agents/:key", async () => {
    let updateBody: Record<string, unknown> | undefined;
    const fetch = makeFetchMock(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/config/agents/agent-1") && init?.method === "PUT") {
        updateBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({
          revision: 2,
          tenant_id: "tenant-1",
          agent_id: "22222222-2222-4222-8222-222222222222",
          agent_key: "agent-1",
          config: {
            model: { model: "openai/gpt-4.1" },
            persona: {
              name: "Ada",
              tone: "direct",
              palette: "moss",
              character: "builder",
            },
            skills: { default_mode: "allow", allow: [], deny: [], workspace_trusted: true },
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
              default_mode: "allow",
              allow: [],
              deny: [],
            },
            conversations: { ttl_days: 30, max_turns: 20 },
          },
          tool_exposure: {
            mcp: { bundle: "workspace-default", tier: "advanced" },
            tools: { bundle: "authoring-core", tier: "default" },
          },
          persona: {
            name: "Ada",
            tone: "direct",
            palette: "moss",
            character: "builder",
          },
          config_sha256: "a".repeat(64),
          created_at: "2026-03-01T00:00:00.000Z",
          created_by: { kind: "tenant.token", token_id: "token-1" },
          reason: "update persona",
          reverted_from_revision: null,
        });
      }

      return jsonResponse({
        revision: 1,
        tenant_id: "tenant-1",
        agent_id: "22222222-2222-4222-8222-222222222222",
        agent_key: "agent-1",
        config: {
          model: { model: "openai/gpt-4.1" },
          persona: {
            name: "Hypatia",
            tone: "direct",
            palette: "graphite",
            character: "architect",
          },
          skills: { default_mode: "allow", allow: [], deny: [], workspace_trusted: true },
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
            default_mode: "allow",
            allow: [],
            deny: [],
          },
          conversations: { ttl_days: 30, max_turns: 20 },
        },
        tool_exposure: {
          mcp: { bundle: "workspace-default", tier: "advanced" },
          tools: { bundle: "authoring-core", tier: "default" },
        },
        persona: {
          name: "Hypatia",
          tone: "direct",
          palette: "graphite",
          character: "architect",
        },
        config_sha256: "a".repeat(64),
        created_at: "2026-03-01T00:00:00.000Z",
        created_by: { kind: "tenant.token", token_id: "token-1" },
        reason: null,
        reverted_from_revision: null,
      });
    });
    const client = createTestClient({ fetch });

    const admin = client as unknown as Record<string, any>;
    const current = await admin.agentConfig.get("agent-1");
    expect(current.persona.name).toBe("Hypatia");
    expect(current.config.mcp.bundle).toBe("workspace-default");
    expect(current.config.mcp.tier).toBe("advanced");
    expect(current.config.tools.bundle).toBe("authoring-core");
    expect(current.config.tools.tier).toBe("default");
    expect(current.tool_exposure).toEqual({
      mcp: { bundle: "workspace-default", tier: "advanced" },
      tools: { bundle: "authoring-core", tier: "default" },
    });

    const updated = await admin.agentConfig.update("agent-1", {
      config: {
        model: { model: "openai/gpt-4.1" },
        persona: {
          name: "Ada",
          tone: "direct",
          palette: "moss",
          character: "builder",
        },
        mcp: {
          bundle: "workspace-default",
          tier: "advanced",
        },
        tools: {
          bundle: "authoring-core",
          tier: "default",
        },
      },
      reason: "update persona",
    });
    expect(updated.persona.name).toBe("Ada");
    expect(updated.config.mcp.bundle).toBe("workspace-default");
    expect(updated.config.tools.bundle).toBe("authoring-core");
    expect(updated.tool_exposure).toEqual({
      mcp: { bundle: "workspace-default", tier: "advanced" },
      tools: { bundle: "authoring-core", tier: "default" },
    });
    expect(updateBody).toMatchObject({
      config: {
        mcp: { bundle: "workspace-default", tier: "advanced" },
        tools: { bundle: "authoring-core", tier: "default" },
      },
      reason: "update persona",
    });
  });

  it("agentStatus reads the additive canonical tool exposure model", async () => {
    const fetch = mockJsonFetch({
      enabled: false,
      home: "/tmp/agent-1",
      persona: {
        name: "Hypatia",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
      identity: {
        name: "Hypatia",
      },
      model: { model: "disabled/disabled" },
      skills: [],
      mcp: [],
      tools: [],
      tool_exposure: {
        mcp: { bundle: "workspace-default", tier: "advanced" },
        tools: {},
      },
      tool_access: { default_mode: "deny", allow: ["read"], deny: [] },
      conversations: { ttl_days: 30, max_turns: 20 },
    });
    const client = createTestClient({ fetch });

    const result = await client.agentStatus.get({ agent_key: "agent-1" });

    expect(result.tool_exposure).toEqual({
      mcp: { bundle: "workspace-default", tier: "advanced" },
      tools: {},
    });
    expect(result.tool_access?.allow).toEqual(["read"]);
  });
}
