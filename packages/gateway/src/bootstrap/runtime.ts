import { wireContainer } from "../container.js";
import { AuthTokenService } from "../modules/auth/auth-token-service.js";
import { DeploymentConfigDal } from "../modules/config/deployment-config-dal.js";
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

  const dbPath = resolveGatewayDbPath(tyrumHome, params.db);
  const migrationsDir = resolveGatewayMigrationsDir(dbPath, params.migrationsDir);
  const isLocalOnly = isLoopbackOnlyHost(host);

  assertSplitRoleUsesPostgres(role, dbPath);
  ensureDatabaseDirectory(dbPath);

  const db = await openGatewayDb({ dbPath, migrationsDir });
  const deploymentConfigDal = new DeploymentConfigDal(db);
  const startupOverrides: StartCommandOverrides = {
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
    },
    { deploymentConfig },
  );
  container.modelsDev.startBackgroundRefresh();
  assertSharedStateModeGuardrails({ dbPath, deploymentConfig });
  await seedDefaultAgentConfig(container);

  const authTokens = new AuthTokenService(container.db);
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

  const secretKeyProvider = isSharedStateMode(deploymentConfig)
    ? createSharedSecretKeyProvider()
    : createLocalSecretKeyProvider({ dbPath, tyrumHome });
  const secrets = await createDbSecretProviderFactory({
    db: container.db,
    dbPath,
    tyrumHome,
    keyProvider: secretKeyProvider,
  });

  if (container.telegramBot) {
    console.log("Telegram bot initialized");
  }

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
    deploymentConfig,
    container,
    logger,
    authTokens,
    secretProviderForTenant: secrets.secretProviderForTenant,
    lifecycleHooks: [],
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
  const protocol = await createProtocolRuntime(context, otel);
  const edge = await startEdgeRuntime(context, protocol, otel);
  const workerLoop = createWorkerLoop(context, protocol);

  fireGatewayStartHook(context, protocol);

  const shutdown = createShutdownHandler(context, {
    background,
    protocol,
    edge,
    workerLoop,
    otel,
  });
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}
