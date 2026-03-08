import { AgentConfig } from "@tyrum/schemas";
import { describe, expect, it } from "vitest";
import { DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_KEY } from "../../src/modules/identity/scope.js";
import { seedPausedExecutionRun } from "../helpers/execution-fixtures.js";
import { createTestApp } from "./helpers.js";

function sampleConfig(name: string) {
  return AgentConfig.parse({
    model: { model: "openai/gpt-4.1" },
    persona: {
      name,
      description: `${name} managed agent`,
      tone: "direct",
      palette: "graphite",
      character: "architect",
    },
  });
}

describe("Managed agents routes integration", () => {
  it("lists managed agents from the database", async () => {
    const { app } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const res = await app.request("/agents");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agents: Array<{ agent_key: string; can_delete: boolean }>;
    };
    expect(body.agents[0]?.agent_key).toBe("default");
    expect(body.agents[0]?.can_delete).toBe(false);
  });

  it("creates a managed agent and rejects duplicates", async () => {
    const { app } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const create = await app.request("/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_key: "agent-1",
        config: sampleConfig("Agent One"),
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as {
      agent_key: string;
      has_config: boolean;
      has_identity: boolean;
      identity: { meta: { name: string } };
    };
    expect(created.agent_key).toBe("agent-1");
    expect(created.has_config).toBe(true);
    expect(created.has_identity).toBe(true);
    expect(created.identity.meta.name).toBe("Agent One");

    const duplicate = await app.request("/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_key: "agent-1",
        config: sampleConfig("Agent One"),
      }),
    });
    expect(duplicate.status).toBe(409);

    const list = await app.request("/agents");
    const body = (await list.json()) as {
      agents: Array<{ agent_key: string }>;
    };
    expect(body.agents.map((agent) => agent.agent_key)).toEqual(["default", "agent-1"]);
  });

  it("returns 404 when updating a missing managed agent", async () => {
    const { app } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const res = await app.request("/agents/missing-agent", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: sampleConfig("Missing Agent"),
      }),
    });
    expect(res.status).toBe(404);
  });

  it("blocks deletion of the default managed agent", async () => {
    const { app } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const res = await app.request("/agents/default", {
      method: "DELETE",
    });
    expect(res.status).toBe(409);
  });

  it("blocks deletion when the agent has active runs", async () => {
    const { app, container } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const create = await app.request("/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_key: "agent-busy",
        config: sampleConfig("Busy Agent"),
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { agent_id: string; agent_key: string };

    const workspaceId = await container.identityScopeDal.ensureWorkspaceId(
      DEFAULT_TENANT_ID,
      DEFAULT_WORKSPACE_KEY,
    );
    await seedPausedExecutionRun({
      db: container.db,
      tenantId: DEFAULT_TENANT_ID,
      agentId: created.agent_id,
      workspaceId,
      jobId: "job-agent-busy",
      runId: "run-agent-busy",
      key: `agent:${created.agent_key}:chat-1:main:thread-1`,
      runStatus: "running",
      jobStatus: "running",
    });

    const remove = await app.request("/agents/agent-busy", {
      method: "DELETE",
    });
    expect(remove.status).toBe(409);
  });

  it("deletes an idle managed agent", async () => {
    const { app } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const create = await app.request("/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_key: "agent-delete",
        config: sampleConfig("Delete Agent"),
      }),
    });
    expect(create.status).toBe(201);

    const remove = await app.request("/agents/agent-delete", {
      method: "DELETE",
    });
    expect(remove.status).toBe(200);
    const deleted = (await remove.json()) as { agent_key: string; deleted: boolean };
    expect(deleted.agent_key).toBe("agent-delete");
    expect(deleted.deleted).toBe(true);

    const get = await app.request("/agents/agent-delete");
    expect(get.status).toBe(404);
  });
});
