import { expect, it, vi } from "vitest";
import type { RequestInit } from "undici";
import { createTestClient, jsonResponse, makeFetchMock } from "./http-client.test-support.js";

export function registerHttpClientManagedAgentTests(): void {
  it("agents.list and agents.get use the managed agents endpoints", async () => {
    const fetch = makeFetchMock(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/agents")) {
        return jsonResponse({
          agents: [
            {
              agent_id: "11111111-1111-4111-8111-111111111111",
              agent_key: "default",
              created_at: "2026-03-08T00:00:00.000Z",
              updated_at: "2026-03-08T00:00:00.000Z",
              has_config: true,
              has_identity: true,
              can_delete: false,
              persona: {
                name: "Default Agent",
                description: "Managed default agent.",
                tone: "direct",
                palette: "graphite",
                character: "architect",
              },
            },
          ],
        });
      }

      return jsonResponse({
        agent_id: "22222222-2222-4222-8222-222222222222",
        agent_key: "agent-1",
        created_at: "2026-03-08T00:00:00.000Z",
        updated_at: "2026-03-08T00:00:00.000Z",
        has_config: true,
        has_identity: true,
        can_delete: true,
        persona: {
          name: "Agent One",
          description: "Managed agent.",
          tone: "direct",
          palette: "graphite",
          character: "architect",
        },
        config: {
          model: { model: "openai/gpt-4.1" },
          persona: {
            name: "Agent One",
            description: "Managed agent.",
            tone: "direct",
            palette: "graphite",
            character: "architect",
          },
        },
        identity: {
          meta: {
            name: "Agent One",
            description: "Managed agent.",
            style: { tone: "direct" },
          },
          body: "",
        },
        config_revision: 1,
        identity_revision: 1,
        config_sha256: "a".repeat(64),
        identity_sha256: "b".repeat(64),
      });
    });
    const client = createTestClient({ fetch });

    const list = await client.agents.list();
    expect(list.agents).toHaveLength(1);
    expect(list.agents[0].agent_key).toBe("default");

    const detail = await client.agents.get("agent-1");
    expect(detail.agent_key).toBe("agent-1");
    expect(detail.identity.meta.name).toBe("Agent One");

    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const [listUrl] = calls[0] as [string, RequestInit];
    const [getUrl] = calls[1] as [string, RequestInit];
    expect(listUrl).toBe("https://gateway.example/agents");
    expect(getUrl).toBe("https://gateway.example/agents/agent-1");
  });

  it("agents.create, update, and delete use explicit CRUD semantics", async () => {
    const fetch = makeFetchMock(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/agents") && init?.method === "POST") {
        return jsonResponse(
          {
            agent_id: "33333333-3333-4333-8333-333333333333",
            agent_key: "agent-2",
            created_at: "2026-03-08T00:00:00.000Z",
            updated_at: "2026-03-08T00:00:00.000Z",
            has_config: true,
            has_identity: true,
            can_delete: true,
            persona: {
              name: "Agent Two",
              description: "Managed agent.",
              tone: "direct",
              palette: "graphite",
              character: "architect",
            },
            config: {
              model: { model: "openai/gpt-4.1" },
              persona: {
                name: "Agent Two",
                description: "Managed agent.",
                tone: "direct",
                palette: "graphite",
                character: "architect",
              },
            },
            identity: {
              meta: {
                name: "Agent Two",
                description: "Managed agent.",
                style: { tone: "direct" },
              },
              body: "",
            },
            config_revision: 1,
            identity_revision: 1,
            config_sha256: "a".repeat(64),
            identity_sha256: "b".repeat(64),
          },
          201,
        );
      }

      if (url.endsWith("/agents/agent-2") && init?.method === "PUT") {
        return jsonResponse({
          agent_id: "33333333-3333-4333-8333-333333333333",
          agent_key: "agent-2",
          created_at: "2026-03-08T00:00:00.000Z",
          updated_at: "2026-03-08T00:00:00.000Z",
          has_config: true,
          has_identity: true,
          can_delete: true,
          persona: {
            name: "Agent Two",
            description: "Updated managed agent.",
            tone: "direct",
            palette: "graphite",
            character: "architect",
          },
          config: {
            model: { model: "openai/gpt-4.1" },
            persona: {
              name: "Agent Two",
              description: "Updated managed agent.",
              tone: "direct",
              palette: "graphite",
              character: "architect",
            },
          },
          identity: {
            meta: {
              name: "Agent Two",
              description: "Updated managed agent.",
              style: { tone: "direct" },
            },
            body: "updated",
          },
          config_revision: 2,
          identity_revision: 2,
          config_sha256: "c".repeat(64),
          identity_sha256: "d".repeat(64),
        });
      }

      return jsonResponse({
        agent_id: "33333333-3333-4333-8333-333333333333",
        agent_key: "agent-2",
        deleted: true,
      });
    });
    const client = createTestClient({ fetch });

    const created = await client.agents.create({
      agent_key: "agent-2",
      config: {
        model: { model: "openai/gpt-4.1" },
        persona: {
          name: "Agent Two",
          description: "Managed agent.",
          tone: "direct",
          palette: "graphite",
          character: "architect",
        },
      },
      identity: {
        meta: {
          name: "Agent Two",
          description: "Managed agent.",
          style: { tone: "direct" },
        },
        body: "",
      },
    });
    expect(created.agent_key).toBe("agent-2");

    const updated = await client.agents.update("agent-2", {
      config: {
        model: { model: "openai/gpt-4.1" },
        persona: {
          name: "Agent Two",
          description: "Updated managed agent.",
          tone: "direct",
          palette: "graphite",
          character: "architect",
        },
      },
      identity: {
        meta: {
          name: "Agent Two",
          description: "Updated managed agent.",
          style: { tone: "direct" },
        },
        body: "updated",
      },
    });
    expect(updated.identity.body).toBe("updated");

    const deleted = await client.agents.delete("agent-2");
    expect(deleted.deleted).toBe(true);

    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const [createUrl, createInit] = calls[0] as [string, RequestInit];
    const [updateUrl, updateInit] = calls[1] as [string, RequestInit];
    const [deleteUrl, deleteInit] = calls[2] as [string, RequestInit];
    expect(createUrl).toBe("https://gateway.example/agents");
    expect(createInit.method).toBe("POST");
    expect(updateUrl).toBe("https://gateway.example/agents/agent-2");
    expect(updateInit.method).toBe("PUT");
    expect(deleteUrl).toBe("https://gateway.example/agents/agent-2");
    expect(deleteInit.method).toBe("DELETE");
  });
}
