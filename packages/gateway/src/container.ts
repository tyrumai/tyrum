/**
 * Dependency injection container — plain constructor injection.
 *
 * Creates and wires all module instances from a configuration object.
 */

import type { EventBus } from "./event-bus.js";
import type { MemoryDal } from "./modules/memory/memory-dal.js";
import type { EventLog } from "./modules/planner/event-log.js";
import type { DiscoveryPipeline } from "./modules/discovery/pipeline.js";
import type { RiskClassifier } from "./modules/risk/classifier.js";
import type { SessionDal } from "./modules/agent/session-dal.js";
import type { SessionLaneNodeAttachmentDal } from "./modules/agent/session-lane-node-attachment-dal.js";
import type { ApprovalDal } from "./modules/approval/dal.js";
import type { WatcherProcessor } from "./modules/watcher/processor.js";
import type { CanvasDal } from "./modules/canvas/dal.js";
import type { PresenceDal } from "./modules/presence/dal.js";
import type { PolicySnapshotDal } from "./modules/policy/snapshot-dal.js";
import type { PolicyOverrideDal } from "./modules/policy/override-dal.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { NodePairingDal } from "./modules/node/pairing-dal.js";
import type { ContextReportDal } from "./modules/context/report-dal.js";
import type { SecretResolutionAuditDal } from "./modules/secret/resolution-audit-dal.js";
import type { SqlDb } from "./statestore/types.js";
import type { ModelsDevService } from "./modules/models/models-dev-service.js";
import type { ModelCatalogService } from "./modules/models/model-catalog-service.js";
import type { OauthPendingDal } from "./modules/oauth/pending-dal.js";
import type { OauthRefreshLeaseDal } from "./modules/oauth/refresh-lease-dal.js";
import type { OAuthProviderRegistry } from "./modules/oauth/provider-registry.js";
import type { IdentityScopeDal } from "./modules/identity/scope.js";
import type { ChannelThreadDal } from "./modules/channels/thread-dal.js";
import {
  DEFAULT_PUBLIC_BASE_URL,
  DeploymentConfig,
  type DeploymentConfig as DeploymentConfigT,
} from "@tyrum/contracts";
import { PolicyService as PolicyServiceImpl } from "@tyrum/runtime-policy";

import { createEventBus } from "./event-bus.js";
import { MemoryDal as MemoryDalImpl } from "./modules/memory/memory-dal.js";
import { EventLog as EventLogImpl } from "./modules/planner/event-log.js";
import { ApprovalDal as ApprovalDalImpl } from "./modules/approval/dal.js";
import {
  DiscoveryPipeline as DiscoveryPipelineImpl,
  InMemoryConnectorCache,
} from "./modules/discovery/pipeline.js";
import {
  RiskClassifier as RiskClassifierImpl,
  defaultRiskConfig,
} from "./modules/risk/classifier.js";
import { SessionDal as SessionDalImpl } from "./modules/agent/session-dal.js";
import { SessionLaneNodeAttachmentDal as SessionLaneNodeAttachmentDalImpl } from "./modules/agent/session-lane-node-attachment-dal.js";
import { WatcherProcessor as WatcherProcessorImpl } from "./modules/watcher/processor.js";
import { CanvasDal as CanvasDalImpl } from "./modules/canvas/dal.js";
import { PresenceDal as PresenceDalImpl } from "./modules/presence/dal.js";
import { PolicySnapshotDal as PolicySnapshotDalImpl } from "./modules/policy/snapshot-dal.js";
import { PolicyOverrideDal as PolicyOverrideDalImpl } from "./modules/policy/override-dal.js";
import { NodePairingDal as NodePairingDalImpl } from "./modules/node/pairing-dal.js";
import { ContextReportDal as ContextReportDalImpl } from "./modules/context/report-dal.js";
import { SecretResolutionAuditDal as SecretResolutionAuditDalImpl } from "./modules/secret/resolution-audit-dal.js";
import { RedactionEngine } from "./modules/redaction/engine.js";
import type { ArtifactStore } from "./modules/artifact/store.js";
import { createArtifactStore } from "./modules/artifact/create-artifact-store.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { Logger, type LogLevel } from "./modules/observability/logger.js";
import { SqliteDb } from "./statestore/sqlite.js";
import { PostgresDb } from "./statestore/postgres.js";
import { isPostgresDbUri } from "./statestore/db-uri.js";
import { ModelsDevCacheDal } from "./modules/models/models-dev-cache-dal.js";
import { ModelsDevRefreshLeaseDal } from "./modules/models/models-dev-refresh-lease-dal.js";
import { ModelsDevService as ModelsDevServiceImpl } from "./modules/models/models-dev-service.js";
import { ModelCatalogService as ModelCatalogServiceImpl } from "./modules/models/model-catalog-service.js";
import { OauthPendingDal as OauthPendingDalImpl } from "./modules/oauth/pending-dal.js";
import { OauthRefreshLeaseDal as OauthRefreshLeaseDalImpl } from "./modules/oauth/refresh-lease-dal.js";
import { OAuthProviderRegistry as OAuthProviderRegistryImpl } from "./modules/oauth/provider-registry.js";
import { IdentityScopeDal as IdentityScopeDalImpl } from "./modules/identity/scope.js";
import { ChannelThreadDal as ChannelThreadDalImpl } from "./modules/channels/thread-dal.js";
import {
  createGatewayConfigStore,
  type GatewayConfigStore,
} from "./modules/runtime-state/gateway-config-store.js";

export interface GatewayContainerConfig {
  dbPath: string;
  migrationsDir: string;
  tyrumHome?: string;
  loggerLevel?: LogLevel;
  logStackTraces?: boolean;
}

export interface GatewayContainer {
  db: SqlDb;
  identityScopeDal: IdentityScopeDal;
  channelThreadDal: ChannelThreadDal;
  memoryDal: MemoryDal;
  contextReportDal: ContextReportDal;
  secretResolutionAuditDal: SecretResolutionAuditDal;
  eventLog: EventLog;
  discoveryPipeline: DiscoveryPipeline;
  riskClassifier: RiskClassifier;
  sessionDal: SessionDal;
  sessionLaneNodeAttachmentDal: SessionLaneNodeAttachmentDal;
  eventBus: EventBus;
  approvalDal: ApprovalDal;
  presenceDal: PresenceDal;
  policySnapshotDal: PolicySnapshotDal;
  policyOverrideDal: PolicyOverrideDal;
  policyService: PolicyService;
  nodePairingDal: NodePairingDal;
  watcherProcessor: WatcherProcessor;
  canvasDal: CanvasDal;
  redactionEngine: RedactionEngine;
  artifactStore: ArtifactStore;
  modelsDev: ModelsDevService;
  modelCatalog: ModelCatalogService;
  oauthPendingDal: OauthPendingDal;
  oauthRefreshLeaseDal: OauthRefreshLeaseDal;
  oauthProviderRegistry: OAuthProviderRegistry;
  logger: Logger;
  config: GatewayContainerConfig;
  deploymentConfig: DeploymentConfigT;
  gatewayConfigStore: GatewayConfigStore;
}

export function createContainer(
  config: GatewayContainerConfig,
  opts?: { redactionEngine?: RedactionEngine; deploymentConfig?: unknown },
): GatewayContainer {
  if (isPostgresDbUri(config.dbPath)) {
    throw new Error(
      `createContainer(...) is synchronous and supports only SQLite db paths. ` +
        `For Postgres (postgres://...), use await createContainerAsync(...).`,
    );
  }

  const db = SqliteDb.open({ dbPath: config.dbPath, migrationsDir: config.migrationsDir });
  return wireContainer(db, config, opts);
}

export async function createContainerAsync(
  config: GatewayContainerConfig,
  opts?: { redactionEngine?: RedactionEngine; deploymentConfig?: unknown },
): Promise<GatewayContainer> {
  const db = isPostgresDbUri(config.dbPath)
    ? await PostgresDb.open({ dbUri: config.dbPath, migrationsDir: config.migrationsDir })
    : SqliteDb.open({ dbPath: config.dbPath, migrationsDir: config.migrationsDir });

  return wireContainer(db, config, opts);
}

export function wireContainer(
  db: SqlDb,
  config: GatewayContainerConfig,
  opts?: { redactionEngine?: RedactionEngine; deploymentConfig?: unknown },
): GatewayContainer {
  const providedDeploymentConfig =
    opts?.deploymentConfig &&
    typeof opts.deploymentConfig === "object" &&
    !Array.isArray(opts.deploymentConfig)
      ? (opts.deploymentConfig as Record<string, unknown>)
      : {};
  const providedServer =
    providedDeploymentConfig["server"] &&
    typeof providedDeploymentConfig["server"] === "object" &&
    !Array.isArray(providedDeploymentConfig["server"])
      ? (providedDeploymentConfig["server"] as Record<string, unknown>)
      : {};
  const deploymentConfig = DeploymentConfig.parse({
    ...providedDeploymentConfig,
    server: {
      publicBaseUrl: DEFAULT_PUBLIC_BASE_URL,
      ...providedServer,
    },
  });
  const identityScopeDal = new IdentityScopeDalImpl(db);
  const channelThreadDal = new ChannelThreadDalImpl(db);
  const memoryDal = new MemoryDalImpl(db);
  const contextReportDal = new ContextReportDalImpl(db);
  const redactionEngine = opts?.redactionEngine ?? new RedactionEngine();
  const logger = new Logger({
    level: config.loggerLevel ?? deploymentConfig.logging.level ?? "info",
    logStackTraces: config.logStackTraces,
    base: { service: "tyrum-gateway" },
  });
  const secretResolutionAuditDal = new SecretResolutionAuditDalImpl(db, logger);
  const eventLog = new EventLogImpl(db, redactionEngine, logger);
  const connectorCache = new InMemoryConnectorCache();
  const discoveryPipeline = new DiscoveryPipelineImpl(connectorCache);
  const riskClassifier = new RiskClassifierImpl(defaultRiskConfig());
  const sessionDal = new SessionDalImpl(db, identityScopeDal, channelThreadDal);
  const sessionLaneNodeAttachmentDal = new SessionLaneNodeAttachmentDalImpl(db);
  const eventBus = createEventBus();
  const approvalDal = new ApprovalDalImpl(db);
  const presenceDal = new PresenceDalImpl(db);
  const policySnapshotDal = new PolicySnapshotDalImpl(db);
  const policyOverrideDal = new PolicyOverrideDalImpl(db);
  const nodePairingDal = new NodePairingDalImpl(db);
  const watcherProcessor = new WatcherProcessorImpl({ db, memoryDal, eventBus });
  const canvasDal = new CanvasDalImpl(db);

  const tyrumHome = config.tyrumHome ?? join(homedir(), ".tyrum");
  const resolvedConfig: GatewayContainerConfig = { ...config, tyrumHome };
  const artifactStore = createArtifactStore(
    {
      ...deploymentConfig.artifacts,
      dir: deploymentConfig.artifacts.dir ?? join(tyrumHome, "artifacts"),
      s3: {
        ...deploymentConfig.artifacts.s3,
        bucket: deploymentConfig.artifacts.s3.bucket ?? "tyrum-artifacts",
        region: deploymentConfig.artifacts.s3.region ?? "us-east-1",
        forcePathStyle:
          deploymentConfig.artifacts.s3.forcePathStyle ??
          Boolean(deploymentConfig.artifacts.s3.endpoint),
      },
    },
    redactionEngine,
    deploymentConfig.server.publicBaseUrl,
  );
  const gatewayConfigStore = createGatewayConfigStore({ db });
  const policyService = new PolicyServiceImpl({
    snapshotDal: policySnapshotDal,
    overrideDal: policyOverrideDal,
    deploymentPolicy: deploymentConfig.policy,
    configStore: gatewayConfigStore,
  });

  const modelsDevCacheDal = new ModelsDevCacheDal(db);
  const modelsDevRefreshLeaseDal = new ModelsDevRefreshLeaseDal(db);
  const modelsDev = new ModelsDevServiceImpl({
    cacheDal: modelsDevCacheDal,
    leaseDal: modelsDevRefreshLeaseDal,
    logger,
    modelsDev: deploymentConfig.modelsDev,
  });
  const modelCatalog = new ModelCatalogServiceImpl({ db, modelsDev });

  const oauthPendingDal = new OauthPendingDalImpl(db);
  const oauthRefreshLeaseDal = new OauthRefreshLeaseDalImpl(db);
  const oauthProviderRegistry = new OAuthProviderRegistryImpl(db);

  return {
    db,
    identityScopeDal,
    channelThreadDal,
    memoryDal,
    contextReportDal,
    secretResolutionAuditDal,
    eventLog,
    discoveryPipeline,
    riskClassifier,
    sessionDal,
    sessionLaneNodeAttachmentDal,
    eventBus,
    approvalDal,
    presenceDal,
    policySnapshotDal,
    policyOverrideDal,
    policyService,
    nodePairingDal,
    watcherProcessor,
    canvasDal,
    redactionEngine,
    artifactStore,
    modelsDev,
    modelCatalog,
    oauthPendingDal,
    oauthRefreshLeaseDal,
    oauthProviderRegistry,
    logger,
    config: resolvedConfig,
    deploymentConfig,
    gatewayConfigStore,
  };
}
