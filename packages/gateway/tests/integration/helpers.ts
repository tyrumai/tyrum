/**
 * Shared test helpers for integration tests.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer } from "../../src/container.js";
import { createApp } from "../../src/app.js";
import type { GatewayContainer } from "../../src/container.js";
import { isAgentEnabled } from "../../src/modules/agent/enabled.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import type { TokenStore } from "../../src/modules/auth/token-store.js";
import type { Hono } from "hono";

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
}

export async function createTestApp(opts: TestAppOptions = {}): Promise<{
  app: Hono;
  container: GatewayContainer;
  agentRuntime?: AgentRuntime;
}> {
  const container = await createTestContainer();
  const agentRuntime = isAgentEnabled() ? new AgentRuntime({ container }) : undefined;
  const app = createApp(container, {
    agentRuntime,
    tokenStore: opts.tokenStore,
    isLocalOnly: opts.isLocalOnly,
  });
  return { app, container, agentRuntime };
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
