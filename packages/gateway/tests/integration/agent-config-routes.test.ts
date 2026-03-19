import { describe, it, expect } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { AgentConfig, AgentConfigGetResponse } from "@tyrum/contracts";
import { createTestApp } from "./helpers.js";

describe("Agent config routes integration", () => {
  it("lists agents for the default tenant", async () => {
    const { app } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const res = await app.request("/config/agents");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: Array<{ agent_key: string }> };
    expect(body.agents.some((agent) => agent.agent_key === "default")).toBe(true);
  });

  it("returns 404 for unknown agents", async () => {
    const { app } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const res = await app.request("/config/agents/missing-agent");
    expect(res.status).toBe(404);
  });

  it("creates revisions, lists them, and reverts", async () => {
    const { app, auth, container } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const countIdentityRevisions = async (): Promise<number> => {
      const row = await container.db.get<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM agent_identity_revisions
         WHERE tenant_id = ?
           AND agent_id = (
             SELECT agent_id
             FROM agents
             WHERE tenant_id = ? AND agent_key = 'default'
             LIMIT 1
           )`,
        [auth.tenantId, auth.tenantId],
      );
      return row?.count ?? 0;
    };

    const identityCountBefore = await countIdentityRevisions();
    const readAgentUpdatedAt = async (): Promise<string | null> => {
      const row = await container.db.get<{ updated_at: string | null }>(
        `SELECT updated_at
         FROM agents
         WHERE tenant_id = ? AND agent_key = 'default'
         LIMIT 1`,
        [auth.tenantId],
      );
      return row?.updated_at ?? null;
    };

    const configV1 = AgentConfig.parse({
      model: { model: "openai/gpt-4.1" },
      persona: {
        name: "Hypatia",
        description: "Calm systems thinker.",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
      tools: { allow: ["read"] },
    });

    const putInvalidJson = await app.request("/config/agents/default", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(putInvalidJson.status).toBe(400);

    const putInvalidBody = await app.request("/config/agents/default", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: {} }),
    });
    expect(putInvalidBody.status).toBe(400);

    const putV1 = await app.request("/config/agents/default", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: configV1, reason: "seed v1" }),
    });
    expect(putV1.status).toBe(200);
    const v1 = (await putV1.json()) as {
      revision: number;
      config_sha256: string;
      config: { persona?: { name: string } };
      persona?: { name: string };
    };
    expect(v1.revision).toBeGreaterThan(0);
    expect(v1.config_sha256.length > 0).toBe(true);
    expect(v1.config.persona?.name).toBe("Hypatia");
    expect(v1.persona?.name).toBe("Hypatia");
    expect(await countIdentityRevisions()).toBe(identityCountBefore);
    const updatedAtAfterV1 = await readAgentUpdatedAt();

    await delay(1_100);
    const configV2 = AgentConfig.parse({
      model: { model: "openai/gpt-4.1" },
      persona: {
        name: "Hypatia",
        description: "Calm systems thinker.",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
      tools: { allow: ["read", "write"] },
    });
    const putV2 = await app.request("/config/agents/default", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: configV2, reason: "update v2" }),
    });
    expect(putV2.status).toBe(200);
    const v2 = (await putV2.json()) as { revision: number; config_sha256: string };
    expect(v2.revision).toBeGreaterThan(v1.revision);
    expect(await countIdentityRevisions()).toBe(identityCountBefore);
    const updatedAtAfterV2 = await readAgentUpdatedAt();
    expect(updatedAtAfterV2).not.toBe(updatedAtAfterV1);

    const get = await app.request("/config/agents/default");
    expect(get.status).toBe(200);
    const getBody = (await get.json()) as {
      config: { persona?: { name: string } };
      persona?: { name: string; tone: string };
    };
    expect(getBody.config.persona?.name).toBe("Hypatia");
    expect(getBody.persona).toEqual(expect.objectContaining({ name: "Hypatia", tone: "direct" }));

    const revisions = await app.request(`/config/agents/default/revisions?limit=5`);
    expect(revisions.status).toBe(200);
    const revisionsBody = (await revisions.json()) as { revisions: Array<{ revision: number }> };
    expect(revisionsBody.revisions.length).toBeGreaterThanOrEqual(2);
    expect(revisionsBody.revisions.some((r) => r.revision === v1.revision)).toBe(true);
    expect(revisionsBody.revisions.some((r) => r.revision === v2.revision)).toBe(true);

    const revisionsBadLimit = await app.request(`/config/agents/default/revisions?limit=not-a-num`);
    expect(revisionsBadLimit.status).toBe(200);

    const revertMissingAgent = await app.request("/config/agents/missing-agent/revert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: v1.revision, reason: "revert" }),
    });
    expect(revertMissingAgent.status).toBe(404);

    const revertInvalidJson = await app.request("/config/agents/default/revert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(revertInvalidJson.status).toBe(400);

    const revertInvalidBody = await app.request("/config/agents/default/revert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: -1 }),
    });
    expect(revertInvalidBody.status).toBe(400);

    await delay(1_100);
    const revert = await app.request("/config/agents/default/revert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: v1.revision, reason: "revert to v1" }),
    });
    expect(revert.status).toBe(200);
    const reverted = AgentConfigGetResponse.parse((await revert.json()) as unknown);
    expect(reverted.revision).toBeGreaterThan(v2.revision);
    expect(reverted.reverted_from_revision).toBe(v1.revision);
    expect(reverted.persona).toEqual(expect.objectContaining({ name: "Hypatia", tone: "direct" }));
    const updatedAtAfterRevert = await readAgentUpdatedAt();
    expect(updatedAtAfterRevert).not.toBe(updatedAtAfterV2);

    const list = await app.request("/config/agents");
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      agents: Array<{ agent_key: string; persona?: { name: string } }>;
    };
    expect(listBody.agents).toContainEqual(
      expect.objectContaining({
        agent_key: "default",
        persona: expect.objectContaining({ name: "Hypatia" }),
      }),
    );
  });
});
