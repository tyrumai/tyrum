/**
 * Shared test helpers for integration tests.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer } from "../../src/container.js";
import { createApp } from "../../src/app.js";
import type { GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import type { Hono } from "hono";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations");

export function createTestContainer(): GatewayContainer {
  return createContainer({
    dbPath: ":memory:",
    migrationsDir,
  });
}

export function createTestApp(): {
  app: Hono;
  container: GatewayContainer;
  agentRuntime?: AgentRuntime;
} {
  const container = createTestContainer();
  const agentRuntime =
    process.env["TYRUM_AGENT_ENABLED"] === "1"
      ? new AgentRuntime({ container })
      : undefined;
  const app = createApp(container, { agentRuntime });
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
