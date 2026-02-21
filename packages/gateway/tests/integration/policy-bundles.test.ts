import { describe, expect, it } from "vitest";
import { PolicyBundle } from "@tyrum/schemas";
import { createTestApp } from "./helpers.js";

describe("policy bundle routes", () => {
  it("stores and returns scoped policy bundles", async () => {
    const { app } = await createTestApp();

    const agentBundle = PolicyBundle.parse({
      version: 1,
      tools: { allow: [], deny: [], require_approval: [], default: "allow" },
      actions: { allow: [], deny: ["CLI"], require_approval: [], default: "allow" },
      network: {
        egress: {
          allow_hosts: ["*"],
          deny_hosts: [],
          require_approval_hosts: [],
          default: "allow",
        },
      },
      secrets: {
        resolve: {
          allow: [],
          deny: [],
          require_approval: [],
          default: "allow",
        },
      },
      provenance: { rules: [] },
    });

    const putRes = await app.request("/policy/bundles/agent/agent-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bundle: agentBundle }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as { ok?: boolean; content_hash?: string };
    expect(putBody.ok).toBe(true);
    expect(typeof putBody.content_hash).toBe("string");

    const getRes = await app.request("/policy/bundles/agent/agent-1");
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      scope_kind: string;
      scope_id: string;
      content_hash: string;
      bundle: unknown;
    };

    expect(getBody.scope_kind).toBe("agent");
    expect(getBody.scope_id).toBe("agent-1");
    expect(getBody.content_hash).toBe(putBody.content_hash);
    expect(PolicyBundle.parse(getBody.bundle)).toEqual(agentBundle);
  });
});

