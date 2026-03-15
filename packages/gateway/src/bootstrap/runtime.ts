import { wireContainer } from "../container.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { AuthTokenService } from "../modules/auth/auth-token-service.js";
import { DeploymentConfigDal } from "../modules/config/deployment-config-dal.js";
import {
  DesktopEnvironmentDal,
  DesktopEnvironmentHostDal,
} from "../modules/desktop-environments/dal.js";
import { DesktopEnvironmentHostRuntime } from "../modules/desktop-environments/host-runtime.js";
import { DesktopEnvironmentRuntimeManager } from "../modules/desktop-environments/runtime-manager.js";
import { DEFAULT_TENANT_ID } from "../modules/identity/scope.js";
import { maybeStartOtel } from "../modules/observability/otel.js";
import { createDbSecretProviderFactory } from "../modules/secret/create-secret-provider.js";
import {
  createLocalSecretKeyProvider,
  createSharedSecretKeyProvider,
} from "../modules/secret/key-provider.js";
import { isSharedStateMode } from "../modules/runtime-state/mode.js";
import { assertSharedStateModeGuardrails } from "../modules/runtime-state/validation.js";
import { VERSION } from "../version.js";
import {
  applyStartCommandDeploymentOverrides,
  assertSplitRoleUsesPostgres,
  buildStartupDefaultDeploymentConfig,
  ensureDatabaseDirectory,
  openGatewayDb,
  resolveGatewayDbPath,
  resolveGatewayHome,
  resolveGatewayHost,
  resolveGatewayLogLevel,
  resolveGatewayLogStackTraces,
  resolveGatewayMigrationsDir,
  resolveGatewayPort,
  seedDefaultAgentConfig,
  type GatewayStartOptions,
  type StartCommandOverrides,
} from "./config.js";
import {
  assertNonLoopbackDeploymentGuardrails,
  isLoopbackOnlyHost,
  splitHostAndPort,
  type GatewayRole,
  type NonLoopbackTransportPolicy,
} from "./network.js";
import {
  createProtocolRuntime,
  createShutdownHandler,
  createWorkerLoop,
  fireGatewayStartHook,
  startBackgroundSchedulers,
  startEdgeRuntime,
} from "./runtime-builders.js";
import type { GatewayBootContext } from "./runtime-shared.js";

function resolveProvisionedGatewayToken(): string | undefined {
  const token =
    process.env["TYRUM_GATEWAY_TOKEN"]?.trim() ?? process.env["GATEWAY_TOKEN"]?.trim() ?? "";
  return token.length > 0 ? token : undefined;
}

async function ensureBootstrapTokens(authTokens: AuthTokenService): Promise<boolean> {
  const bootstrapTokens: Array<{ label: string; token: string }> = [];
  if ((await authTokens.countActiveSystemTokens()) === 0) {
    const issued = await authTokens.issueToken({
      tenantId: null,
      role: "admin",
      scopes: ["*"],
    });
    bootstrapTokens.push({ label: "system", token: issued.token });
  }

  let hasDefaultTenantAdminToken =
    (await authTokens.countActiveTenantAdminTokens(DEFAULT_TENANT_ID)) > 0;
  if (!hasDefaultTenantAdminToken) {
    const issued = await authTokens.issueToken({
      tenantId: DEFAULT_TENANT_ID,
      role: "admin",
      scopes: ["*"],
    });
    bootstrapTokens.push({ label: "default-tenant-admin", token: issued.token });
    hasDefaultTenantAdminToken = true;
  }

  if (bootstrapTokens.length > 0) {
    console.log("---");
    console.log("Bootstrap tokens (printed once):");
    for (const entry of bootstrapTokens) {
      console.log(`${entry.label}: ${entry.token}`);
    }
    console.log("---");
  }

  return hasDefaultTenantAdminToken;
}

function logTransportPolicy(policy: NonLoopbackTransportPolicy): void {
  if (policy === "local") return;

  console.log("---");
  console.log("Gateway is exposed on a non-local interface.");
  if (policy === "insecure") {
    console.log(
      "WARNING: plaintext HTTP is allowed by deployment config server.allowInsecureHttp.",
    );
    console.log("Configure TLS termination and set deployment config server.tlsReady=true.");
  }
  console.log("---");
}

async function loadOrCreateDesktopRuntimeHostId(tyrumHome: string): Promise<string> {
  const stateDir = join(tyrumHome, "runtime-state");
  const hostIdPath = join(stateDir, "desktop-runtime-host-id");
  try {
    const existing = (await readFile(hostIdPath, "utf8")).trim();
    if (existing.length > 0) return existing;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "ENOENT") throw error;
  }

  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const created = `desktop-host-${crypto.randomUUID()}`;
  await writeFile(hostIdPath, `${created}\n`, { mode: 0o600 });
  return created;
}

async function createGatewayBootContext(
  input?: GatewayRole | GatewayStartOptions,
): Promise<GatewayBootContext> {
  const params = typeof input === "string" ? { role: input } : (input ?? {});

  const instanceId = `gw-${crypto.randomUUID()}`;
  const role = params.role ?? "all";
  const tyrumHome = resolveGatewayHome(params.home);

  const hostRaw = resolveGatewayHost(params.host);
  const hostSplit = splitHostAndPort(hostRaw);
  if (hostSplit.port) {
    throw new Error(
      `--host must not include a port (got '${hostRaw}'). Use --port ${hostSplit.port} instead.`,
    );
  }
  const host = hostSplit.host;
  const port = resolveGatewayPort(params.port);
  const loggerLevel = resolveGatewayLogLevel({
    logLevelOverride: params.logLevel,
    debugOverride: params.debug,
  });
  const logStackTraces = resolveGatewayLogStackTraces({
    logLevelOverride: params.logLevel,
    debugOverride: params.debug,
  });

  const dbPath = resolveGatewayDbPath(tyrumHome, params.db);
  const migrationsDir = resolveGatewayMigrationsDir(dbPath, params.migrationsDir);
  const isLocalOnly = isLoopbackOnlyHost(host);

  assertSplitRoleUsesPostgres(role, dbPath);
  ensureDatabaseDirectory(dbPath);

  const db = await openGatewayDb({ dbPath, migrationsDir });
  const deploymentConfigDal = new DeploymentConfigDal(db);
  const startupOverrides: StartCommandOverrides = {
    trustedProxies: params.trustedProxies,
    tlsReady: params.tlsReady,
    tlsSelfSigned: params.tlsSelfSigned,
    allowInsecureHttp: params.allowInsecureHttp,
    engineApiEnabled: params.engineApiEnabled,
    snapshotImportEnabled: params.snapshotImportEnabled,
  };
  const deploymentRevision = await deploymentConfigDal.ensureSeeded({
    defaultConfig: buildStartupDefaultDeploymentConfig(startupOverrides),
    createdBy: { kind: "bootstrap" },
    reason: "seed",
  });
  const deploymentConfig = applyStartCommandDeploymentOverrides(
    deploymentRevision.config,
    startupOverrides,
  );

  const container = wireContainer(
    db,
    {
      dbPath,
      migrationsDir,
      tyrumHome,
      ...(loggerLevel !== undefined ? { loggerLevel } : {}),
      ...(logStackTraces !== undefined ? { logStackTraces } : {}),
    },
    { deploymentConfig },
  );
  container.modelsDev.startBackgroundRefresh();
  assertSharedStateModeGuardrails({ dbPath, deploymentConfig });
  await seedDefaultAgentConfig(container);

  const provisionedGatewayToken = resolveProvisionedGatewayToken();
  const authTokens = new AuthTokenService(container.db, {
    provisionedTokens: provisionedGatewayToken
      ? [
          {
            token: provisionedGatewayToken,
            tenantId: DEFAULT_TENANT_ID,
            role: "admin",
            scopes: ["*"],
            tokenId: "provisioned-default-tenant-admin",
          },
        ]
      : [],
  });
  const hasDefaultTenantAdminToken = await ensureBootstrapTokens(authTokens);
  const transportPolicy = assertNonLoopbackDeploymentGuardrails({
    role,
    host,
    tlsReady: deploymentConfig.server.tlsReady,
    tlsSelfSigned: deploymentConfig.server.tlsSelfSigned,
    allowInsecureHttp: deploymentConfig.server.allowInsecureHttp,
    hasTenantAdminToken: hasDefaultTenantAdminToken,
  });
  logTransportPolicy(transportPolicy);

  const logger = container.logger.child({
    role,
    instance_id: instanceId,
    version: VERSION,
  });
  logger.info("gateway.instance", { instance_id: instanceId });
  const lifecycleHooks: [] = [];

  const secretKeyProvider = isSharedStateMode(deploymentConfig)
    ? createSharedSecretKeyProvider()
    : createLocalSecretKeyProvider({ dbPath, tyrumHome });
  const secrets = await createDbSecretProviderFactory({
    db: container.db,
    dbPath,
    tyrumHome,
    keyProvider: secretKeyProvider,
  });

  return {
    instanceId,
    role,
    tyrumHome,
    host,
    port,
    dbPath,
    migrationsDir,
    isLocalOnly,
    shouldRunEdge: role === "all" || role === "edge",
    shouldRunWorker: role === "all" || role === "worker",
    shouldRunDesktopRuntime: role === "all" || role === "desktop-runtime",
    deploymentConfig,
    container,
    logger,
    authTokens,
    secretProviderForTenant: secrets.secretProviderForTenant,
    lifecycleHooks,
  };
}

export { runShutdownCleanup } from "./runtime-builders.js";

export async function main(input?: GatewayRole | GatewayStartOptions): Promise<void> {
  const context = await createGatewayBootContext(input);
  const background = await startBackgroundSchedulers(context);
  const otel = await maybeStartOtel({
    serviceName: "tyrum-gateway",
    serviceVersion: VERSION,
    instanceId: context.instanceId,
    otel: context.deploymentConfig.otel,
  });
  if (otel.enabled) {
    context.logger.info("otel.started");
  }

  let pendingShutdownSignal: string | undefined;
  let shutdownHandler: ((signal: string) => void) | undefined;
  const queueOrRunShutdown = (signal: string) => {
    if (shutdownHandler) {
      shutdownHandler(signal);
      return;
    }
    pendingShutdownSignal ??= signal;
  };
  process.once("SIGINT", () => queueOrRunShutdown("SIGINT"));
  process.once("SIGTERM", () => queueOrRunShutdown("SIGTERM"));

  const protocol = await createProtocolRuntime(context, otel);
  const edge = await startEdgeRuntime(context, protocol, otel);
  const workerLoop = createWorkerLoop(context, protocol);
  const desktopRuntimeHostId = context.shouldRunDesktopRuntime
    ? await loadOrCreateDesktopRuntimeHostId(context.tyrumHome)
    : undefined;
  const desktopHostRuntime = context.shouldRunDesktopRuntime
    ? new DesktopEnvironmentHostRuntime(
        new DesktopEnvironmentHostDal(context.container.db),
        new DesktopEnvironmentRuntimeManager(
          new DesktopEnvironmentDal(context.container.db),
          context.container.nodePairingDal,
          context.authTokens,
          context.logger,
          {
            hostId: desktopRuntimeHostId!,
            tyrumHome: context.tyrumHome,
            gatewayPort: context.port,
            gatewayWsUrl: process.env["TYRUM_DESKTOP_ENVIRONMENTS_GATEWAY_WS_URL"]?.trim(),
          },
        ),
        {
          hostId: desktopRuntimeHostId!,
          label: `desktop-runtime:${hostname()}`,
          logger: context.logger,
        },
      )
    : undefined;
  await desktopHostRuntime?.start();

  fireGatewayStartHook(context, protocol);

  shutdownHandler = createShutdownHandler(context, {
    background,
    protocol,
    edge,
    workerLoop,
    desktopHostRuntime,
    otel,
  });
  if (pendingShutdownSignal) {
    const signal = pendingShutdownSignal;
    pendingShutdownSignal = undefined;
    shutdownHandler(signal);
  }
}
