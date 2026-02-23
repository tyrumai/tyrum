/**
 * Shared test helpers for integration tests.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer } from "../../src/container.js";
import { createApp } from "../../src/app.js";
import type { GatewayContainer } from "../../src/container.js";
import { isAgentEnabled } from "../../src/modules/agent/enabled.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import { AgentRegistry as AgentRegistryImpl } from "../../src/modules/agent/registry.js";
import { EnvSecretProvider } from "../../src/modules/secret/provider.js";
import { resolveTyrumHome } from "../../src/modules/agent/home.js";
import { VERSION } from "../../src/version.js";
import type { TokenStore } from "../../src/modules/auth/token-store.js";
import type { Hono } from "hono";
import type { LanguageModel } from "ai";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

export async function createTestContainer(): Promise<GatewayContainer> {
  return await createContainer({
    dbPath: ":memory:",
    migrationsDir,
  });
}

export interface TestAppOptions {
  tokenStore?: TokenStore;
  isLocalOnly?: boolean;
  languageModel?: LanguageModel;
}

export async function createTestApp(opts: TestAppOptions = {}): Promise<{
  app: Hono;
  container: GatewayContainer;
  agents?: AgentRegistry;
}> {
  const container = await createTestContainer();
  const agents = isAgentEnabled()
    ? new AgentRegistryImpl({
        container,
        baseHome: resolveTyrumHome(),
        defaultSecretProvider: new EnvSecretProvider(),
        defaultPolicyService: container.policyService,
        defaultLanguageModel: opts.languageModel,
        approvalNotifier: { notify: () => {} },
        logger: container.logger,
      })
    : undefined;
  const app = createApp(container, {
    agents,
    tokenStore: opts.tokenStore,
    isLocalOnly: opts.isLocalOnly,
    runtime: {
      version: VERSION,
      instanceId: "test-instance",
      role: "all",
      otelEnabled: false,
    },
  });
  return { app, container, agents };
}

/**
 * Builds a minimal valid PlanRequest body for testing.
 */
export function minimalPlanRequest(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    request_id: "test-req-1",
    trigger: {
      thread: {
        id: "thread-1",
        kind: "private",
        pii_fields: [],
      },
      message: {
        id: "msg-1",
        thread_id: "thread-1",
        source: "telegram",
        content: { kind: "text", text: "help me" },
        timestamp: new Date().toISOString(),
        pii_fields: [],
      },
    },
    tags: [],
    ...overrides,
  };
}
