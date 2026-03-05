import { describe, it, expect } from "vitest";
import { AgentConfig } from "@tyrum/schemas";
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
    const { app } = await createTestApp({
      isLocalOnly: false,
      deploymentConfig: { modelsDev: { disableFetch: true } },
    });

    const configV1 = AgentConfig.parse({
      model: { model: "openai/gpt-4.1" },
      tools: { allow: ["tool.fs.read"] },
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
    const v1 = (await putV1.json()) as { revision: number; config_sha256: string };
    expect(v1.revision).toBeGreaterThan(0);
    expect(v1.config_sha256.length > 0).toBe(true);

    const configV2 = AgentConfig.parse({
      model: { model: "openai/gpt-4.1" },
      tools: { allow: ["tool.fs.read", "tool.fs.write"] },
    });
    const putV2 = await app.request("/config/agents/default", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: configV2, reason: "update v2" }),
    });
    expect(putV2.status).toBe(200);
    const v2 = (await putV2.json()) as { revision: number; config_sha256: string };
    expect(v2.revision).toBeGreaterThan(v1.revision);

    const get = await app.request("/config/agents/default");
    expect(get.status).toBe(200);

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

    const revert = await app.request("/config/agents/default/revert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: v1.revision, reason: "revert to v1" }),
    });
    expect(revert.status).toBe(200);
    const reverted = (await revert.json()) as { revision: number; reverted_from_revision: number };
    expect(reverted.revision).toBeGreaterThan(v2.revision);
    expect(reverted.reverted_from_revision).toBe(v1.revision);
  });
});
