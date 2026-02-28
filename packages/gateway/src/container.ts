/**
 * Dependency injection container — plain constructor injection.
 *
 * Creates and wires all module instances from a configuration object.
 */

import type { EventBus } from "./event-bus.js";
import type { MemoryV1Dal } from "./modules/memory/v1-dal.js";
import type { EventLog } from "./modules/planner/event-log.js";
import type { DiscoveryPipeline } from "./modules/discovery/pipeline.js";
import type { RiskClassifier } from "./modules/risk/classifier.js";
import type { SessionDal } from "./modules/agent/session-dal.js";
import type { TelegramBot } from "./modules/ingress/telegram-bot.js";
import type { ApprovalDal } from "./modules/approval/dal.js";
import type { WatcherProcessor } from "./modules/watcher/processor.js";
import type { CanvasDal } from "./modules/canvas/dal.js";
import type { JobQueue } from "./modules/executor/job-queue.js";
import type { PresenceDal } from "./modules/presence/dal.js";
import type { PolicySnapshotDal } from "./modules/policy/snapshot-dal.js";
import type { PolicyOverrideDal } from "./modules/policy/override-dal.js";
import type { PolicyService } from "./modules/policy/service.js";
import type { NodePairingDal } from "./modules/node/pairing-dal.js";
import type { ContextReportDal } from "./modules/context/report-dal.js";
import type { SecretResolutionAuditDal } from "./modules/secret/resolution-audit-dal.js";
import type { SqlDb } from "./statestore/types.js";
import type { ModelsDevService } from "./modules/models/models-dev-service.js";
import type { OauthPendingDal } from "./modules/oauth/pending-dal.js";
import type { OauthRefreshLeaseDal } from "./modules/oauth/refresh-lease-dal.js";
import type { OAuthProviderRegistry } from "./modules/oauth/provider-registry.js";

import { createEventBus } from "./event-bus.js";
import { MemoryV1Dal as MemoryV1DalImpl } from "./modules/memory/v1-dal.js";
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
import { TelegramBot as TelegramBotImpl } from "./modules/ingress/telegram-bot.js";
import { WatcherProcessor as WatcherProcessorImpl } from "./modules/watcher/processor.js";
import { CanvasDal as CanvasDalImpl } from "./modules/canvas/dal.js";
import { JobQueue as JobQueueImpl } from "./modules/executor/job-queue.js";
import { PresenceDal as PresenceDalImpl } from "./modules/presence/dal.js";
import { PolicySnapshotDal as PolicySnapshotDalImpl } from "./modules/policy/snapshot-dal.js";
import { PolicyOverrideDal as PolicyOverrideDalImpl } from "./modules/policy/override-dal.js";
import { PolicyService as PolicyServiceImpl } from "./modules/policy/service.js";
import { NodePairingDal as NodePairingDalImpl } from "./modules/node/pairing-dal.js";
import { ContextReportDal as ContextReportDalImpl } from "./modules/context/report-dal.js";
import { SecretResolutionAuditDal as SecretResolutionAuditDalImpl } from "./modules/secret/resolution-audit-dal.js";
import { RedactionEngine } from "./modules/redaction/engine.js";
import type { ArtifactStore } from "./modules/artifact/store.js";
import {
  createArtifactStore,
  createArtifactStoreFromEnv,
} from "./modules/artifact/create-artifact-store.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { Logger } from "./modules/observability/logger.js";
import { SqliteDb } from "./statestore/sqlite.js";
import { PostgresDb } from "./statestore/postgres.js";
import { isPostgresDbUri } from "./statestore/db-uri.js";
import { ModelsDevCacheDal } from "./modules/models/models-dev-cache-dal.js";
import { ModelsDevRefreshLeaseDal } from "./modules/models/models-dev-refresh-lease-dal.js";
import { ModelsDevService as ModelsDevServiceImpl } from "./modules/models/models-dev-service.js";
import { OauthPendingDal as OauthPendingDalImpl } from "./modules/oauth/pending-dal.js";
import { OauthRefreshLeaseDal as OauthRefreshLeaseDalImpl } from "./modules/oauth/refresh-lease-dal.js";
import { OAuthProviderRegistry as OAuthProviderRegistryImpl } from "./modules/oauth/provider-registry.js";
import type { GatewayConfig as GatewayRuntimeConfig } from "./config.js";

export interface GatewayContainerConfig {
  dbPath: string;
  migrationsDir: string;
  tyrumHome?: string;
  logStackTraces?: boolean;
}

export interface GatewayContainer {
  db: SqlDb;
  memoryV1Dal: MemoryV1Dal;
  contextReportDal: ContextReportDal;
  secretResolutionAuditDal: SecretResolutionAuditDal;
  eventLog: EventLog;
  discoveryPipeline: DiscoveryPipeline;
  riskClassifier: RiskClassifier;
  sessionDal: SessionDal;
  eventBus: EventBus;
  telegramBot?: TelegramBot;
  approvalDal: ApprovalDal;
  presenceDal: PresenceDal;
  policySnapshotDal: PolicySnapshotDal;
  policyOverrideDal: PolicyOverrideDal;
  policyService: PolicyService;
  nodePairingDal: NodePairingDal;
  watcherProcessor: WatcherProcessor;
  canvasDal: CanvasDal;
  jobQueue: JobQueue;
  redactionEngine: RedactionEngine;
  artifactStore: ArtifactStore;
  modelsDev: ModelsDevService;
  oauthPendingDal: OauthPendingDal;
  oauthRefreshLeaseDal: OauthRefreshLeaseDal;
  oauthProviderRegistry: OAuthProviderRegistry;
  logger: Logger;
  config: GatewayContainerConfig;
  gatewayConfig?: GatewayRuntimeConfig;
}

export function createContainer(
  config: GatewayContainerConfig,
  opts?: { redactionEngine?: RedactionEngine; gatewayConfig?: GatewayRuntimeConfig },
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
  opts?: { redactionEngine?: RedactionEngine; gatewayConfig?: GatewayRuntimeConfig },
): Promise<GatewayContainer> {
  const db = isPostgresDbUri(config.dbPath)
    ? await PostgresDb.open({ dbUri: config.dbPath, migrationsDir: config.migrationsDir })
    : SqliteDb.open({ dbPath: config.dbPath, migrationsDir: config.migrationsDir });

  return wireContainer(db, config, opts);
}

function wireContainer(
  db: SqlDb,
  config: GatewayContainerConfig,
  opts?: { redactionEngine?: RedactionEngine; gatewayConfig?: GatewayRuntimeConfig },
): GatewayContainer {
  const memoryV1Dal = new MemoryV1DalImpl(db);
  const contextReportDal = new ContextReportDalImpl(db);
  const redactionEngine = opts?.redactionEngine ?? new RedactionEngine();
  const logger = new Logger({ base: { service: "tyrum-gateway" } });
  const secretResolutionAuditDal = new SecretResolutionAuditDalImpl(db, logger);
  const eventLog = new EventLogImpl(db, redactionEngine, logger);
  const connectorCache = new InMemoryConnectorCache();
  const discoveryPipeline = new DiscoveryPipelineImpl(connectorCache);
  const riskClassifier = new RiskClassifierImpl(defaultRiskConfig());
  const sessionDal = new SessionDalImpl(db);
  const eventBus = createEventBus();

  const telegramToken = opts?.gatewayConfig?.channels.telegramBotToken;
  const telegramBot = telegramToken ? new TelegramBotImpl(telegramToken) : undefined;
  const approvalDal = new ApprovalDalImpl(db);
  const presenceDal = new PresenceDalImpl(db);
  const policySnapshotDal = new PolicySnapshotDalImpl(db);
  const policyOverrideDal = new PolicyOverrideDalImpl(db);
  const nodePairingDal = new NodePairingDalImpl(db);
  const watcherProcessor = new WatcherProcessorImpl({ db, memoryV1Dal, eventBus });
  const canvasDal = new CanvasDalImpl(db);
  const jobQueue = new JobQueueImpl(db);

  const tyrumHome =
    config.tyrumHome ?? opts?.gatewayConfig?.paths.home ?? join(homedir(), ".tyrum");
  const artifactStore = opts?.gatewayConfig
    ? createArtifactStore(opts.gatewayConfig.artifacts, redactionEngine)
    : createArtifactStoreFromEnv(tyrumHome, redactionEngine);
  const policyService = new PolicyServiceImpl({
    home: tyrumHome,
    snapshotDal: policySnapshotDal,
    overrideDal: policyOverrideDal,
    logger,
  });

  const modelsDevCacheDal = new ModelsDevCacheDal(db);
  const modelsDevRefreshLeaseDal = new ModelsDevRefreshLeaseDal(db);
  const modelsDev = new ModelsDevServiceImpl({
    cacheDal: modelsDevCacheDal,
    leaseDal: modelsDevRefreshLeaseDal,
    logger,
    modelsDev: opts?.gatewayConfig?.modelsDev,
    instanceOwner: opts?.gatewayConfig?.runtime.instanceId,
  });

  const oauthPendingDal = new OauthPendingDalImpl(db);
  const oauthRefreshLeaseDal = new OauthRefreshLeaseDalImpl(db);
  const oauthProviderRegistry = new OAuthProviderRegistryImpl({
    configPaths: [
      join(tyrumHome, "oauth-providers.yml"),
      join(tyrumHome, "oauth_providers.yml"),
      join(process.cwd(), "config", "oauth-providers.yml"),
      join(process.cwd(), "config", "oauth_providers.yml"),
    ],
  });

  return {
    db,
    memoryV1Dal,
    contextReportDal,
    secretResolutionAuditDal,
    eventLog,
    discoveryPipeline,
    riskClassifier,
    sessionDal,
    eventBus,
    telegramBot,
    approvalDal,
    presenceDal,
    policySnapshotDal,
    policyOverrideDal,
    policyService,
    nodePairingDal,
    watcherProcessor,
    canvasDal,
    jobQueue,
    redactionEngine,
    artifactStore,
    modelsDev,
    oauthPendingDal,
    oauthRefreshLeaseDal,
    oauthProviderRegistry,
    logger,
    config,
    gatewayConfig: opts?.gatewayConfig,
  };
}
