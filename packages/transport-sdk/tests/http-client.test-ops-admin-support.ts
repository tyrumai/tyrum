import { expect, it, vi } from "vitest";
import type { RequestInit } from "undici";
import { TyrumHttpClientError } from "../src/index.js";
import {
  createTestClient,
  jsonResponse,
  makeFetchMock,
  mockJsonFetch,
} from "./http-client.test-support.js";

export function registerHttpClientOpsAdminTests(): void {
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
    expect(updateBody).toMatchObject({
      config: {
        mcp: { bundle: "workspace-default", tier: "advanced" },
        tools: { bundle: "authoring-core", tier: "default" },
      },
      reason: "update persona",
    });
  });

  it("toolRegistry.list sends GET /config/tools and validates tool metadata", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        status: "ok",
        tools: [
          {
            source: "builtin",
            canonical_id: "read",
            description: "Read files from disk.",
            effect: "read_only",
            effective_exposure: {
              enabled: true,
              reason: "enabled",
              agent_key: "default",
            },
            family: "filesystem",
            group: "core",
            keywords: ["read", "file"],
            input_schema: {
              type: "object",
              properties: {
                path: { type: "string" },
              },
            },
          },
          {
            source: "builtin",
            canonical_id: "bash",
            description: "Execute shell commands.",
            effect: "state_changing",
            effective_exposure: {
              enabled: true,
              reason: "enabled",
              agent_key: "default",
            },
            family: "shell",
            group: "core",
          },
          {
            source: "builtin",
            canonical_id: "artifact.describe",
            description: "Describe artifacts.",
            effect: "read_only",
            effective_exposure: {
              enabled: true,
              reason: "enabled",
              agent_key: "default",
            },
            family: "artifact",
            group: "core",
          },
          {
            source: "builtin_mcp",
            canonical_id: "websearch",
            description: "Search the web.",
            effect: "state_changing",
            effective_exposure: {
              enabled: true,
              reason: "enabled",
              agent_key: "default",
            },
            backing_server: {
              id: "exa",
              name: "Exa",
              transport: "remote",
              url: "https://mcp.exa.ai/mcp",
            },
          },
          {
            source: "plugin",
            canonical_id: "plugin.echo.invalid",
            description: "Plugin descriptor with an invalid input schema.",
            effect: "read_only",
            effective_exposure: {
              enabled: false,
              reason: "disabled_invalid_schema",
              agent_key: "default",
            },
            plugin: {
              id: "echo",
              name: "Echo",
              version: "0.0.1",
            },
          },
        ],
      }),
    );
    const client = createTestClient({ fetch });

    const result = await client.toolRegistry.list();
    expect(result.tools).toHaveLength(5);

    const toolsById = new Map(result.tools.map((tool) => [tool.canonical_id, tool]));
    expect(toolsById.get("read")?.group).toBe("core");
    expect(toolsById.get("bash")).toMatchObject({
      family: "shell",
      group: "core",
      effect: "state_changing",
    });
    expect(toolsById.get("artifact.describe")).toMatchObject({
      family: "artifact",
      group: "core",
      effect: "read_only",
    });
    expect(toolsById.get("websearch")?.backing_server?.id).toBe("exa");
    expect(toolsById.get("plugin.echo.invalid")?.effective_exposure.reason).toBe(
      "disabled_invalid_schema",
    );

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/config/tools");
    expect(init.method).toBe("GET");
  });

  it("health.get sends GET /healthz and validates response", async () => {
    const fetch = mockJsonFetch({ status: "ok", is_exposed: false });
    const client = createTestClient({ fetch });

    const admin = client as unknown as Record<string, any>;
    expect(typeof admin.health?.get).toBe("function");

    const result = await admin.health.get();
    expect(result.status).toBe("ok");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/healthz");
    expect(init.method).toBe("GET");
  });

  it("artifacts.getBytes returns redirect for 302 responses", async () => {
    const fetch = makeFetchMock(async (_input, init) => {
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: { location: "https://signed.example/artifact.bin" },
      });
    });

    const client = createTestClient({ fetch });
    const admin = client as unknown as Record<string, any>;
    const result = await admin.artifacts.getBytes("550e8400-e29b-41d4-a716-446655440000");
    expect(result).toEqual({ kind: "redirect", url: "https://signed.example/artifact.bin" });
  });

  it("artifacts.getBytes returns bytes for 200 responses", async () => {
    const fetch = makeFetchMock(async (_input, init) => {
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      });
    });

    const client = createTestClient({ fetch });
    const admin = client as unknown as Record<string, any>;
    const result = await admin.artifacts.getBytes("550e8400-e29b-41d4-a716-446655440000");

    expect(result.kind).toBe("bytes");
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
    expect(result.contentType).toBe("application/octet-stream");
  });

  it("artifacts.getBytes returns gateway URL for opaque redirects (browser-safe)", async () => {
    const artifactId = "550e8400-e29b-41d4-a716-446655440000";

    const fetch = makeFetchMock(async (input, init) => {
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      expect(String(input)).toBe(`https://gateway.example/a/${artifactId}`);

      const response = new Response(null, { status: 302 });
      Object.defineProperty(response, "type", { value: "opaqueredirect" });
      return response;
    });

    const client = createTestClient({ fetch });
    const admin = client as unknown as Record<string, any>;
    const result = await admin.artifacts.getBytes(artifactId);
    expect(result).toEqual({
      kind: "redirect",
      url: `https://gateway.example/a/${artifactId}`,
    });
  });

  it("audit.verify rejects non-string action entries before network call", async () => {
    const fetch = mockJsonFetch({ valid: true });
    const client = createTestClient({ fetch });

    const admin = client as unknown as Record<string, any>;
    await expect(
      admin.audit.verify({
        events: [
          {
            id: 1,
            plan_id: "plan-1",
            step_index: 0,
            occurred_at: "2026-02-25T00:00:00.000Z",
            action: { type: "not-a-string" },
            prev_hash: null,
            event_hash: null,
          },
        ],
      }),
    ).rejects.toMatchObject<TyrumHttpClientError>({
      code: "request_invalid",
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("204 response with empty body returns undefined through readJsonBody", async () => {
    const fetch = makeFetchMock(async () => new Response(null, { status: 204 }));
    const client = createTestClient({ fetch });

    await expect(client.plugins.list()).rejects.toMatchObject<TyrumHttpClientError>({
      code: "response_invalid",
    });
  });

  it("non-JSON success body produces response_invalid with clear message", async () => {
    const fetch = makeFetchMock(
      async () =>
        new Response("this is not json", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    );
    const client = createTestClient({ fetch });

    await expect(client.plugins.list()).rejects.toMatchObject<TyrumHttpClientError>({
      code: "response_invalid",
      message: "response body is not valid JSON",
    });
  });
}
