import { AgentConfig } from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import {
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_KEY,
} from "../../src/modules/identity/scope.js";
import { createAgentsRoutes } from "../../src/routes/agents.js";
import { seedPausedExecutionRun } from "../helpers/execution-fixtures.js";
import { insertExecutionArtifactRecord } from "./artifact.test-support.js";
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

function createAgentsApp(container: GatewayContainer): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("authClaims", {
      token_kind: "tenant",
      token_id: "tenant-token-1",
      tenant_id: DEFAULT_TENANT_ID,
      role: "admin",
      scopes: ["*"],
    });
    await next();
  });
  app.route(
    "/",
    createAgentsRoutes({
      db: container.db,
      identityScopeDal: container.identityScopeDal,
      stateMode: "local",
    }),
  );
  return app;
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

  it("bumps updated_at when a managed agent is updated", async () => {
    const { app } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const create = await app.request("/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_key: "agent-updated-at",
        config: sampleConfig("Updated At Agent"),
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { updated_at: string };

    await delay(1_100);

    const update = await app.request("/agents/agent-updated-at", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: AgentConfig.parse({
          model: { model: "openai/gpt-4.1" },
          persona: {
            name: "Updated At Agent",
            description: "Managed agent after update.",
            tone: "direct",
            palette: "graphite",
            character: "architect",
          },
        }),
      }),
    });
    expect(update.status).toBe(200);
    const updated = (await update.json()) as { updated_at: string };
    expect(updated.updated_at).not.toBe(created.updated_at);

    const list = await app.request("/agents");
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      agents: Array<{ agent_key: string; updated_at: string }>;
    };
    expect(
      listBody.agents.find((agent) => agent.agent_key === "agent-updated-at")?.updated_at,
    ).toBe(updated.updated_at);
  });

  it("returns 400 for invalid managed agent keys in route params", async () => {
    const { app } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const invalidPath = "/agents/invalid:key";

    const get = await app.request(invalidPath);
    expect(get.status).toBe(400);

    const update = await app.request(invalidPath, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: sampleConfig("Invalid Agent"),
      }),
    });
    expect(update.status).toBe(400);

    const remove = await app.request(invalidPath, {
      method: "DELETE",
    });
    expect(remove.status).toBe(400);
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

  it("deletes a managed agent after detaching retained artifact references", async () => {
    const { app, container } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });
    const agentKey = "agent-artifacts";

    const create = await app.request("/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_key: agentKey,
        config: sampleConfig("Delete Artifact Agent"),
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { agent_id: string };

    const artifactId = randomUUID();
    await insertExecutionArtifactRecord(container.db, {
      artifactId,
      kind: "log",
      uri: "artifact://delete-agent-log",
      createdAt: "2026-03-15T10:00:00.000Z",
      workspaceId: DEFAULT_WORKSPACE_ID,
      agentId: created.agent_id,
    });

    const remove = await app.request(`/agents/${agentKey}`, {
      method: "DELETE",
    });
    expect(remove.status).toBe(200);

    const artifact = await container.db.get<{ agent_id: string | null }>(
      `SELECT agent_id
       FROM execution_artifacts
       WHERE tenant_id = ? AND artifact_id = ?`,
      [DEFAULT_TENANT_ID, artifactId],
    );
    expect(artifact?.agent_id).toBeNull();
  });

  it("returns 409 for one of two concurrent creates with the same agent key", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tyrum-agents-route-test-"));
    const dbPath = join(tempDir, "gateway.db");
    const tyrumHome = join(tempDir, "home");

    const firstContainer = createContainer(
      { dbPath, migrationsDir: join(import.meta.dirname, "../../migrations/sqlite"), tyrumHome },
      { deploymentConfig: { modelsDev: { disableFetch: true } } },
    );
    const secondContainer = createContainer(
      { dbPath, migrationsDir: join(import.meta.dirname, "../../migrations/sqlite"), tyrumHome },
      { deploymentConfig: { modelsDev: { disableFetch: true } } },
    );

    try {
      await firstContainer.db.exec("PRAGMA busy_timeout = 25");
      await secondContainer.db.exec("PRAGMA busy_timeout = 25");

      const firstApp = createAgentsApp(firstContainer);
      const secondApp = createAgentsApp(secondContainer);

      const [first, second] = await Promise.all([
        firstApp.request("/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_key: "agent-race",
            config: sampleConfig("Race Agent"),
          }),
        }),
        secondApp.request("/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_key: "agent-race",
            config: sampleConfig("Race Agent"),
          }),
        }),
      ]);

      const statuses = [first.status, second.status].toSorted((a, b) => a - b);
      expect(statuses).toEqual([201, 409]);

      const row = await firstContainer.db.get<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM agents
         WHERE tenant_id = ? AND agent_key = ?`,
        [DEFAULT_TENANT_ID, "agent-race"],
      );
      expect(row?.count).toBe(1);
    } finally {
      await Promise.all([firstContainer.db.close(), secondContainer.db.close()]);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
