import { afterEach, describe, expect, it } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import type { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { resolveAgentHome } from "../../src/modules/agent/home.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import {
  getOrCreateReviewerRuntime,
  reviewerTurnMetadata,
} from "../../src/modules/review/guardian-review-processor-support.js";
import { setupTestEnv, teardownTestEnv } from "./agent-runtime.test-helpers.js";

const noopSecretProvider: SecretProvider = {
  resolve: async () => null,
  store: async () => {
    throw new Error("not implemented in test");
  },
  revoke: async () => false,
  list: async () => [],
};

describe("guardian reviewer runtime support", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("uses the primary agent key for runtime identity even when the DB scope uses a UUID", async () => {
    ({ homeDir, container } = await setupTestEnv());

    const primaryAgentKey = "ops-agent";
    const resolvedAgentId = await container.identityScopeDal.ensureAgentId(
      DEFAULT_TENANT_ID,
      primaryAgentKey,
    );
    await container.identityScopeDal.ensureAgentId(DEFAULT_TENANT_ID, "default");
    await container.db.run(`UPDATE agents SET is_primary = 0 WHERE tenant_id = ?`, [
      DEFAULT_TENANT_ID,
    ]);
    await container.db.run(
      `UPDATE agents SET is_primary = 1 WHERE tenant_id = ? AND agent_id = ?`,
      [DEFAULT_TENANT_ID, resolvedAgentId],
    );
    container.identityScopeDal.rememberPrimaryAgent(
      DEFAULT_TENANT_ID,
      primaryAgentKey,
      resolvedAgentId,
    );
    const cache = new Map<string, AgentRuntime>();

    const runtime = await getOrCreateReviewerRuntime({
      cache,
      container,
      tenantId: DEFAULT_TENANT_ID,
      secretProviderForTenant: () => noopSecretProvider,
    });

    expect(runtime.agentId).toBe(primaryAgentKey);
    expect(runtime.agentId).not.toBe(resolvedAgentId);
    expect(runtime.home).toBe(resolveAgentHome(container.config.tyrumHome, primaryAgentKey));
    expect(cache.get(DEFAULT_TENANT_ID)).toBe(runtime);
  });

  it("builds reviewer turn metadata on the primary agent subagent lane", () => {
    expect(
      reviewerTurnMetadata({
        agentKey: "ops-agent",
        subagentId: "subagent-1",
        subjectType: "approval",
        targetId: "approval-1",
      }),
    ).toMatchObject({
      tyrum_key: "agent:ops-agent:subagent:subagent-1",
      lane: "subagent",
      subagent_id: "subagent-1",
    });
  });
});
