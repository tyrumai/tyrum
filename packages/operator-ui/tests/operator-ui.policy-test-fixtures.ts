import { TyrumHttpClientError } from "@tyrum/operator-app/browser";
import { vi } from "vitest";

export function createPolicyHttpFixtures() {
  const policyGetBundle = vi.fn(
    async () =>
      ({
        status: "ok",
        generated_at: "2026-03-01T00:00:00.000Z",
        effective: {
          sha256: "policy-sha-1",
          bundle: {
            v: 1,
            tools: { default: "require_approval", allow: ["read"], require_approval: [], deny: [] },
            network_egress: {
              default: "require_approval",
              allow: [],
              require_approval: [],
              deny: [],
            },
            secrets: { default: "require_approval", allow: [], require_approval: [], deny: [] },
            connectors: {
              default: "require_approval",
              allow: ["telegram:*"],
              require_approval: [],
              deny: [],
            },
            artifacts: { default: "allow" },
            provenance: { untrusted_shell_requires_approval: true },
          },
          sources: { deployment: "default", agent: null, playbook: null },
        },
      }) as const,
  );
  const policyListOverrides = vi.fn(async () => ({ overrides: [] }) as const);
  const policyCreateOverride = vi.fn(async () => ({ override: {} }) as const);
  const policyRevokeOverride = vi.fn(async () => ({ override: {} }) as const);
  const policyConfigGetDeployment = vi.fn(async () => {
    throw new TyrumHttpClientError("http_error", "not found", {
      status: 404,
      error: "not_found",
    });
  });
  const policyConfigListDeploymentRevisions = vi.fn(async () => ({ revisions: [] }) as const);
  const policyConfigUpdateDeployment = vi.fn(
    async (input: { bundle: unknown; reason?: string }) =>
      ({
        revision: 1,
        agent_key: null,
        bundle: input.bundle,
        created_at: "2026-03-01T00:00:00.000Z",
        created_by: { kind: "tenant.token", token_id: "token-1" },
        reason: input.reason,
        reverted_from_revision: null,
      }) as const,
  );
  const policyConfigRevertDeployment = vi.fn(
    async (input: { revision: number; reason?: string }) =>
      ({
        revision: 2,
        agent_key: null,
        bundle: {
          v: 1,
          tools: {
            default: "require_approval",
            allow: ["read"],
            require_approval: [],
            deny: [],
          },
        },
        created_at: "2026-03-01T00:00:00.000Z",
        created_by: { kind: "tenant.token", token_id: "token-1" },
        reason: input.reason,
        reverted_from_revision: input.revision,
      }) as const,
  );
  const policyConfigGetAgent = vi.fn(async (agentKey: string) => ({
    revision: 1,
    agent_key: agentKey,
    bundle: { v: 1 },
    created_at: "2026-03-01T00:00:00.000Z",
    created_by: { kind: "tenant.token", token_id: "token-1" },
    reason: null,
    reverted_from_revision: null,
  }));
  const policyConfigListAgentRevisions = vi.fn(async () => ({ revisions: [] }) as const);
  const policyConfigUpdateAgent = vi.fn(
    async (agentKey: string, input: { bundle: unknown; reason?: string }) => ({
      revision: 1,
      agent_key: agentKey,
      bundle: input.bundle,
      created_at: "2026-03-01T00:00:00.000Z",
      created_by: { kind: "tenant.token", token_id: "token-1" },
      reason: input.reason ?? null,
      reverted_from_revision: null,
    }),
  );
  const policyConfigRevertAgent = vi.fn(
    async (agentKey: string, input: { revision: number; reason?: string }) => ({
      revision: input.revision + 1,
      agent_key: agentKey,
      bundle: { v: 1 },
      created_at: "2026-03-01T00:00:00.000Z",
      created_by: { kind: "tenant.token", token_id: "token-1" },
      reason: input.reason ?? null,
      reverted_from_revision: input.revision,
    }),
  );

  return {
    policyGetBundle,
    policyListOverrides,
    policyCreateOverride,
    policyRevokeOverride,
    policyConfigGetDeployment,
    policyConfigListDeploymentRevisions,
    policyConfigUpdateDeployment,
    policyConfigRevertDeployment,
    policyConfigGetAgent,
    policyConfigListAgentRevisions,
    policyConfigUpdateAgent,
    policyConfigRevertAgent,
  };
}
