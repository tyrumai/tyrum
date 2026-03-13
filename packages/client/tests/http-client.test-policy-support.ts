import { expect, it, vi } from "vitest";
import type { RequestInit } from "undici";
import { createTestClient, jsonResponse, makeFetchMock } from "./http-client.test-support.js";

export function registerHttpClientPolicyTests(): void {
  it("policy.getBundle sends GET /policy/bundle and validates nested response", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        status: "ok",
        generated_at: "2026-02-25T00:00:00.000Z",
        effective: {
          sha256: "a".repeat(64),
          bundle: { v: 1 },
          sources: {
            deployment: "prod",
            agent: null,
            playbook: null,
          },
        },
      }),
    );
    const client = createTestClient({ fetch });

    const result = await client.policy.getBundle();
    expect(result.status).toBe("ok");
    expect(result.effective.bundle.v).toBe(1);
  });

  it("policyConfig.getDeployment sends GET /config/policy/deployment", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        revision: 3,
        bundle: {
          v: 1,
          tools: {
            default: "require_approval",
            allow: ["read"],
            require_approval: ["bash"],
            deny: [],
          },
        },
        agent_key: null,
        created_at: "2026-02-25T00:00:00.000Z",
        created_by: { kind: "tenant.token", token_id: "tok_1" },
        reason: "tightened tool defaults",
        reverted_from_revision: null,
      }),
    );
    const client = createTestClient({ fetch });

    const result = await client.policyConfig.getDeployment();
    expect(result.revision).toBe(3);
    expect(result.bundle.tools?.default).toBe("require_approval");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/config/policy/deployment");
    expect(init.method).toBe("GET");
  });

  it("policyConfig.listDeploymentRevisions sends GET /config/policy/deployment/revisions", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        revisions: [
          {
            revision: 3,
            agent_key: null,
            created_at: "2026-02-25T00:00:00.000Z",
            created_by: { kind: "tenant.token", token_id: "tok_1" },
            reason: "tightened tool defaults",
            reverted_from_revision: null,
          },
          {
            revision: 2,
            agent_key: null,
            created_at: "2026-02-24T00:00:00.000Z",
            created_by: { kind: "tenant.token", token_id: "tok_1" },
            reason: null,
            reverted_from_revision: 1,
          },
        ],
      }),
    );
    const client = createTestClient({ fetch });

    const result = await client.policyConfig.listDeploymentRevisions();
    expect(result.revisions).toHaveLength(2);
    expect(result.revisions[1]?.reverted_from_revision).toBe(1);

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/config/policy/deployment/revisions");
    expect(init.method).toBe("GET");
  });

  it("policyConfig.updateDeployment sends PUT /config/policy/deployment and validates the bundle", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        revision: 4,
        bundle: {
          v: 1,
          tools: {
            default: "deny",
            allow: ["read"],
            require_approval: [],
            deny: [],
          },
        },
        agent_key: null,
        created_at: "2026-02-25T00:00:00.000Z",
        created_by: { kind: "tenant.token", token_id: "tok_1" },
        reason: "allow read",
        reverted_from_revision: null,
      }),
    );
    const client = createTestClient({ fetch });

    const result = await client.policyConfig.updateDeployment({
      bundle: {
        v: 1,
        tools: {
          default: "deny",
          allow: ["tool.fs.read"],
          require_approval: [],
          deny: [],
        },
      },
      reason: "allow read",
    });
    expect(result.revision).toBe(4);
    expect(result.bundle.tools?.allow).toEqual(["read"]);

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/config/policy/deployment");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      bundle: {
        v: 1,
        approvals: {
          auto_review: {
            mode: "auto_review",
          },
        },
        tools: {
          default: "deny",
          allow: ["read"],
          require_approval: [],
          deny: [],
        },
      },
      reason: "allow read",
    });
  });

  it("policyConfig.revertDeployment sends POST /config/policy/deployment/revert", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        revision: 5,
        bundle: { v: 1 },
        agent_key: null,
        created_at: "2026-02-25T00:00:00.000Z",
        created_by: { kind: "tenant.token", token_id: "tok_1" },
        reason: "rollback",
        reverted_from_revision: 3,
      }),
    );
    const client = createTestClient({ fetch });

    const result = await client.policyConfig.revertDeployment({
      revision: 3,
      reason: "rollback",
    });
    expect(result.reverted_from_revision).toBe(3);

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/config/policy/deployment/revert");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      revision: 3,
      reason: "rollback",
    });
  });

  it("policy.createOverride sends POST /policy/overrides and expects 201", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse(
        {
          override: {
            policy_override_id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
            status: "active",
            created_at: "2026-02-25T00:00:00.000Z",
            agent_id: "00000000-0000-4000-8000-000000000002",
            tool_id: "bash",
            pattern: "*",
          },
        },
        201,
      ),
    );
    const client = createTestClient({ fetch });

    const result = await client.policy.createOverride({
      agent_id: "00000000-0000-4000-8000-000000000002",
      tool_id: "bash",
      pattern: "*",
    });
    expect(result.override.status).toBe("active");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/policy/overrides");
    expect(init.method).toBe("POST");
  });

  it("policy.revokeOverride sends POST /policy/overrides/revoke", async () => {
    const fetch = makeFetchMock(async () =>
      jsonResponse({
        override: {
          policy_override_id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
          status: "revoked",
          created_at: "2026-02-25T00:00:00.000Z",
          agent_id: "00000000-0000-4000-8000-000000000002",
          tool_id: "bash",
          pattern: "*",
        },
      }),
    );
    const client = createTestClient({ fetch });

    const result = await client.policy.revokeOverride({
      policy_override_id: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
    });
    expect(result.override.status).toBe("revoked");

    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://gateway.example/policy/overrides/revoke");
    expect(init.method).toBe("POST");
  });
}
