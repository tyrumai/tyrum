/**
 * Shared test helpers for integration tests.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach } from "vitest";
import { createContainer } from "../../src/container.js";
import { createApp } from "../../src/app.js";
import type { GatewayContainer } from "../../src/container.js";
import { loadConfig } from "../../src/config.js";
import { isAgentEnabled } from "../../src/modules/agent/enabled.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import { AgentRegistry as AgentRegistryImpl } from "../../src/modules/agent/registry.js";
import { createDbSecretProvider } from "../../src/modules/secret/create-secret-provider.js";
import { VERSION } from "../../src/version.js";
import type { TokenStore } from "../../src/modules/auth/token-store.js";
import type { SlidingWindowRateLimiter } from "../../src/modules/auth/rate-limiter.js";
import type { Hono } from "hono";
import type { LanguageModel } from "ai";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const tempHomesToCleanup: string[] = [];

function isRejected<T>(res: PromiseSettledResult<T>): res is PromiseRejectedResult {
  return res.status === "rejected";
}

afterEach(async () => {
  if (tempHomesToCleanup.length === 0) return;

  const homes = tempHomesToCleanup.splice(0);
  const results = await Promise.allSettled(
    homes.map(async (home) => {
      await rm(home, { recursive: true, force: true });
    }),
  );

  const failures = results.filter(isRejected);
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `failed to cleanup ${String(failures.length)} tyrum test home(s)`,
    );
  }
});

async function createTempTyrumHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "tyrum-test-home-"));
  tempHomesToCleanup.push(home);
  return home;
}

function normalizeOptionalTyrumHome(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

export async function createTestContainer(
  opts: { tyrumHome?: string } = {},
): Promise<GatewayContainer> {
  const baseHome = normalizeOptionalTyrumHome(opts.tyrumHome) ?? (await createTempTyrumHome());
  return createTestContainerWith({ dbPath: ":memory:", tyrumHome: baseHome });
}

function createTestContainerWith(opts: { dbPath: string; tyrumHome: string }): GatewayContainer {
  const gatewayConfig = loadConfig({
    ...process.env,
    GATEWAY_TOKEN: "test-token",
    TYRUM_HOME: opts.tyrumHome,
  });
  return createContainer(
    {
      dbPath: opts.dbPath,
      migrationsDir,
      tyrumHome: opts.tyrumHome,
    },
    { gatewayConfig },
  );
}

export interface TestAppOptions {
  tokenStore?: TokenStore;
  isLocalOnly?: boolean;
  languageModel?: LanguageModel;
  tyrumHome?: string;
  authRateLimiter?: SlidingWindowRateLimiter;
}

export async function createTestApp(opts: TestAppOptions = {}): Promise<{
  app: Hono;
  container: GatewayContainer;
  agents?: AgentRegistry;
}> {
  const baseHome = normalizeOptionalTyrumHome(opts.tyrumHome) ?? (await createTempTyrumHome());
  const container = createTestContainerWith({ dbPath: ":memory:", tyrumHome: baseHome });
  const agents = isAgentEnabled()
    ? new AgentRegistryImpl({
        container,
        baseHome,
        defaultSecretProvider: await createDbSecretProvider({
          db: container.db,
          dbPath: ":memory:",
          tyrumHome: baseHome,
        }),
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
    authRateLimiter: opts.authRateLimiter,
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
