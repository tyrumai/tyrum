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
import {
  DEFAULT_PUBLIC_BASE_URL,
  DeploymentConfig,
  type DeploymentConfig as DeploymentConfigT,
} from "@tyrum/contracts";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import { AgentRegistry as AgentRegistryImpl } from "../../src/modules/agent/registry.js";
import { ApprovalEngineActionProcessor } from "../../src/modules/approval/engine-action-processor.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { createDbSecretProviderFactory } from "../../src/modules/secret/create-secret-provider.js";
import { VERSION } from "../../src/version.js";
import type { SlidingWindowRateLimiter } from "../../src/modules/auth/rate-limiter.js";
import type { Hono } from "hono";
import type { LanguageModel } from "ai";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import type { DesktopEnvironmentLifecycle } from "../../src/modules/desktop-environments/lifecycle-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function resolveDeploymentConfig(overrides?: Partial<DeploymentConfigT>): DeploymentConfigT {
  return DeploymentConfig.parse({
    ...overrides,
    server: {
      publicBaseUrl: overrides?.server?.publicBaseUrl ?? DEFAULT_PUBLIC_BASE_URL,
      ...overrides?.server,
    },
  });
}

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

async function resolveTestTyrumHome(override?: string): Promise<string> {
  const explicit = normalizeOptionalTyrumHome(override);
  if (explicit) return explicit;

  const envHome = normalizeOptionalTyrumHome(process.env["TYRUM_HOME"]);
  if (envHome) return envHome;

  return await createTempTyrumHome();
}

export function decorateAppWithDefaultAuth(app: Hono, token: string) {
  const originalRequest = app.request.bind(app);

  const requestWithDefaultAuth: typeof app.request = (input, requestInit) => {
    if (input instanceof Request) {
      return originalRequest(input, requestInit);
    }

    const headers = new Headers(requestInit?.headers);
    if (!headers.has("authorization")) {
      headers.set("authorization", `Bearer ${token}`);
    }
    return originalRequest(input, { ...requestInit, headers });
  };

  (app as unknown as { request: typeof app.request }).request = requestWithDefaultAuth;

  return {
    request: requestWithDefaultAuth,
    requestUnauthenticated: originalRequest,
  };
}

export async function createTestAuthAndSecrets(
  container: GatewayContainer,
  opts?: {
    dbPath?: string;
    tyrumHome?: string;
  },
): Promise<{
  authTokens: AuthTokenService;
  systemToken: string;
  tenantAdminToken: string;
  secretProviderForTenant: (
    tenantId: string,
  ) => ReturnType<
    Awaited<ReturnType<typeof createDbSecretProviderFactory>>["secretProviderForTenant"]
  >;
}> {
  const baseHome = normalizeOptionalTyrumHome(opts?.tyrumHome) ?? container.config.tyrumHome;
  const secrets = await createDbSecretProviderFactory({
    db: container.db,
    dbPath: opts?.dbPath ?? container.config.dbPath,
    tyrumHome: baseHome,
  });

  const authTokens = new AuthTokenService(container.db);
  const systemIssued = await authTokens.issueToken({
    tenantId: null,
    role: "admin",
    scopes: ["*"],
  });
  const tenantIssued = await authTokens.issueToken({
    tenantId: DEFAULT_TENANT_ID,
    role: "admin",
    scopes: ["*"],
  });

  return {
    authTokens,
    systemToken: systemIssued.token,
    tenantAdminToken: tenantIssued.token,
    secretProviderForTenant: secrets.secretProviderForTenant,
  };
}

export async function createTestContainer(opts?: {
  dbPath?: string;
  tyrumHome?: string;
  deploymentConfig?: Partial<DeploymentConfigT>;
}): Promise<GatewayContainer> {
  const dbPath = opts?.dbPath ?? ":memory:";
  const tyrumHome = await resolveTestTyrumHome(opts?.tyrumHome);
  const deploymentConfig = resolveDeploymentConfig(opts?.deploymentConfig);
  return createContainer(
    {
      dbPath,
      migrationsDir,
      tyrumHome,
    },
    { deploymentConfig },
  );
}

export interface TestAppOptions {
  isLocalOnly?: boolean;
  languageModel?: LanguageModel;
  tyrumHome?: string;
  runtimeRole?: string;
  desktopTakeoverAdvertiseOrigin?: string;
  authRateLimiter?: SlidingWindowRateLimiter;
  deploymentConfig?: Partial<DeploymentConfigT>;
  enableAgents?: boolean;
  operatorUiAssetsDir?: string;
  provisionedTenantAdminToken?: string;
  desktopEnvironmentLifecycle?: DesktopEnvironmentLifecycle;
}

export async function createTestApp(opts: TestAppOptions = {}): Promise<
  {
    app: Hono;
    container: GatewayContainer;
    agents?: AgentRegistry;
    auth: {
      tenantId: string;
      systemToken: string;
      tenantAdminToken: string;
      authTokens: AuthTokenService;
    };
  } & ReturnType<typeof decorateAppWithDefaultAuth>
> {
  const baseHome = await resolveTestTyrumHome(opts.tyrumHome);

  const container = await createTestContainer({
    dbPath: ":memory:",
    tyrumHome: baseHome,
    deploymentConfig: opts.deploymentConfig,
  });

  const secrets = await createDbSecretProviderFactory({
    db: container.db,
    dbPath: ":memory:",
    tyrumHome: baseHome,
  });

  const provisionedTenantAdminToken = opts.provisionedTenantAdminToken?.trim();
  const authTokens = new AuthTokenService(container.db, {
    provisionedTokens: provisionedTenantAdminToken
      ? [
          {
            token: provisionedTenantAdminToken,
            tenantId: DEFAULT_TENANT_ID,
            role: "admin",
            scopes: ["*"],
            tokenId: "provisioned-default-tenant-admin",
          },
        ]
      : [],
  });
  const systemIssued = await authTokens.issueToken({
    tenantId: null,
    role: "admin",
    scopes: ["*"],
  });
  const tenantIssued = provisionedTenantAdminToken
    ? undefined
    : await authTokens.issueToken({
        tenantId: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      });

  const shouldEnableAgents = opts.enableAgents ?? container.deploymentConfig.agent.enabled;
  const agents = shouldEnableAgents
    ? new AgentRegistryImpl({
        container,
        baseHome,
        secretProviderForTenant: secrets.secretProviderForTenant,
        defaultPolicyService: container.policyService,
        defaultLanguageModel: opts.languageModel,
        logger: container.logger,
      })
    : undefined;

  const app = createApp(container, {
    agents,
    authTokens,
    secretProviderForTenant: secrets.secretProviderForTenant,
    isLocalOnly: opts.isLocalOnly,
    authRateLimiter: opts.authRateLimiter,
    operatorUiAssetsDir: opts.operatorUiAssetsDir,
    desktopEnvironmentLifecycle: opts.desktopEnvironmentLifecycle,
    runtime: {
      version: VERSION,
      instanceId: "test-instance",
      role: opts.runtimeRole ?? "all",
      otelEnabled: false,
      desktopTakeoverAdvertiseOrigin: opts.desktopTakeoverAdvertiseOrigin,
    },
  });

  const tenantAdminToken = provisionedTenantAdminToken ?? tenantIssued!.token;
  const decorated = decorateAppWithDefaultAuth(app, tenantAdminToken);

  return {
    app,
    container,
    agents,
    auth: {
      tenantId: DEFAULT_TENANT_ID,
      systemToken: systemIssued.token,
      tenantAdminToken,
      authTokens,
    },
    ...decorated,
  };
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
        content: { text: "help me", attachments: [] },
        timestamp: new Date().toISOString(),
        pii_fields: [],
      },
    },
    tags: [],
    ...overrides,
  };
}

function resolveApprovalEngineActionEngine(
  container: GatewayContainer,
  engine: ExecutionEngine | undefined,
): ExecutionEngine {
  return (
    engine ??
    new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    })
  );
}

export function startApprovalEngineActionProcessorForTests(input: {
  container: GatewayContainer;
  engine?: ExecutionEngine;
}): ApprovalEngineActionProcessor {
  const engine = resolveApprovalEngineActionEngine(input.container, input.engine);
  const processor = new ApprovalEngineActionProcessor({
    db: input.container.db,
    engine,
    owner: "test-instance",
    logger: input.container.logger,
    tickMs: 1,
    leaseTtlMs: 5_000,
    maxAttempts: 10,
    batchSize: 10,
  });
  processor.start();
  return processor;
}

export async function drainApprovalEngineActions(input: {
  container: GatewayContainer;
  engine?: ExecutionEngine;
  maxTicks?: number;
}): Promise<void> {
  const engine = resolveApprovalEngineActionEngine(input.container, input.engine);
  const processor = new ApprovalEngineActionProcessor({
    db: input.container.db,
    engine,
    owner: "test-instance",
    logger: input.container.logger,
    tickMs: 1,
    leaseTtlMs: 5_000,
    maxAttempts: 10,
    batchSize: 10,
  });

  const maxTicks = input.maxTicks ?? 25;
  for (let i = 0; i < maxTicks; i += 1) {
    await processor.tick();
    const pending = await input.container.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM approval_engine_actions
       WHERE tenant_id = ?
         AND status IN ('queued', 'processing')`,
      [DEFAULT_TENANT_ID],
    );
    if ((pending?.count ?? 0) === 0) return;
  }

  const rows = await input.container.db.all<{
    action_id: string;
    approval_id: string;
    action_kind: string;
    status: string;
    attempts: number;
    last_error: string | null;
  }>(
    `SELECT action_id, approval_id, action_kind, status, attempts, last_error
     FROM approval_engine_actions
     WHERE tenant_id = ?
       AND status IN ('queued', 'processing')
     ORDER BY updated_at ASC, action_id ASC`,
    [DEFAULT_TENANT_ID],
  );
  throw new Error(`timed out draining approval engine actions: ${JSON.stringify(rows, null, 2)}`);
}
