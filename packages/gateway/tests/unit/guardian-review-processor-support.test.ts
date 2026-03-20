import { afterEach, describe, expect, it } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import { resolveAgentHome } from "../../src/modules/agent/home.js";
import { DEFAULT_AGENT_KEY, DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
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

  it("uses the default agent key for runtime identity even when the DB scope uses a UUID", async () => {
    ({ homeDir, container } = await setupTestEnv());

    const resolvedAgentId = await container.identityScopeDal.ensureAgentId(
      DEFAULT_TENANT_ID,
      DEFAULT_AGENT_KEY,
    );
    const cache = new Map<string, ReturnType<typeof getOrCreateReviewerRuntime>>();

    const runtime = getOrCreateReviewerRuntime({
      cache,
      container,
      tenantId: DEFAULT_TENANT_ID,
      secretProviderForTenant: () => noopSecretProvider,
    });

    expect(runtime.agentId).toBe(DEFAULT_AGENT_KEY);
    expect(runtime.agentId).not.toBe(resolvedAgentId);
    expect(runtime.home).toBe(resolveAgentHome(container.config.tyrumHome, DEFAULT_AGENT_KEY));
    expect(cache.get(DEFAULT_TENANT_ID)).toBe(runtime);
  });

  it("builds reviewer turn metadata on the default agent subagent lane", () => {
    expect(
      reviewerTurnMetadata({
        subagentId: "subagent-1",
        subjectType: "approval",
        targetId: "approval-1",
      }),
    ).toMatchObject({
      tyrum_key: "agent:default:subagent:subagent-1",
      lane: "subagent",
      subagent_id: "subagent-1",
    });
  });
});
