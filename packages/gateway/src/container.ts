/**
 * Dependency injection container — plain constructor injection.
 *
 * Creates and wires all module instances from a configuration object.
 */

import type { EventBus } from "./event-bus.js";
import type { MemoryDal } from "./modules/memory/dal.js";
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
import type { NodeDal } from "./modules/node/dal.js";
import type { PolicySnapshotDal } from "./modules/policy/snapshot-dal.js";
import type { AuthProfileDal } from "./modules/model/auth-profile-dal.js";
import type { SqlDb } from "./statestore/types.js";

import { createEventBus } from "./event-bus.js";
import { MemoryDal as MemoryDalImpl } from "./modules/memory/dal.js";
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
import { NodeDal as NodeDalImpl } from "./modules/node/dal.js";
import { PolicySnapshotDal as PolicySnapshotDalImpl } from "./modules/policy/snapshot-dal.js";
import { AuthProfileDal as AuthProfileDalImpl } from "./modules/model/auth-profile-dal.js";
import { RedactionEngine } from "./modules/redaction/engine.js";
import type { ArtifactStore } from "./modules/artifact/store.js";
import type { ArtifactMetadataDal } from "./modules/artifact/metadata-dal.js";
import { createArtifactStoreFromEnv } from "./modules/artifact/create-artifact-store.js";
import { ArtifactMetadataDal as ArtifactMetadataDalImpl } from "./modules/artifact/metadata-dal.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { Logger } from "./modules/observability/logger.js";
import { SqliteDb } from "./statestore/sqlite.js";
import { PostgresDb } from "./statestore/postgres.js";
import { isPostgresDbUri } from "./statestore/db-uri.js";

export interface GatewayConfig {
  dbPath: string;
  migrationsDir: string;
  modelGatewayConfigPath?: string;
  tyrumHome?: string;
}

export interface GatewayContainer {
  db: SqlDb;
  memoryDal: MemoryDal;
  eventLog: EventLog;
  discoveryPipeline: DiscoveryPipeline;
  riskClassifier: RiskClassifier;
  sessionDal: SessionDal;
  eventBus: EventBus;
  telegramBot?: TelegramBot;
  approvalDal: ApprovalDal;
  watcherProcessor: WatcherProcessor;
  canvasDal: CanvasDal;
  jobQueue: JobQueue;
  presenceDal: PresenceDal;
  redactionEngine: RedactionEngine;
  artifactStore: ArtifactStore;
  artifactMetadataDal: ArtifactMetadataDal;
  nodeDal: NodeDal;
  policySnapshotDal: PolicySnapshotDal;
  authProfileDal: AuthProfileDal;
  logger: Logger;
  config: GatewayConfig;
}

export function createContainer(
  config: GatewayConfig,
  opts?: { redactionEngine?: RedactionEngine },
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
  config: GatewayConfig,
  opts?: { redactionEngine?: RedactionEngine },
): Promise<GatewayContainer> {
  const db = isPostgresDbUri(config.dbPath)
    ? await PostgresDb.open({ dbUri: config.dbPath, migrationsDir: config.migrationsDir })
    : SqliteDb.open({ dbPath: config.dbPath, migrationsDir: config.migrationsDir });

  return wireContainer(db, config, opts);
}

function wireContainer(
  db: SqlDb,
  config: GatewayConfig,
  opts?: { redactionEngine?: RedactionEngine },
): GatewayContainer {
  const memoryDal = new MemoryDalImpl(db);
  const redactionEngine = opts?.redactionEngine ?? new RedactionEngine();
  const logger = new Logger({ base: { service: "tyrum-gateway" } });
  const eventLog = new EventLogImpl(db, redactionEngine, logger);
  const connectorCache = new InMemoryConnectorCache();
  const discoveryPipeline = new DiscoveryPipelineImpl(connectorCache, {
    capabilityMemorySource: memoryDal,
  });
  const riskClassifier = new RiskClassifierImpl(defaultRiskConfig());
  const sessionDal = new SessionDalImpl(db);
  const eventBus = createEventBus();

  const telegramToken = process.env["TELEGRAM_BOT_TOKEN"]?.trim();
  const telegramBot = telegramToken
    ? new TelegramBotImpl(telegramToken)
    : undefined;
  const approvalDal = new ApprovalDalImpl(db);
  const watcherProcessor = new WatcherProcessorImpl({ db, memoryDal, eventBus });
  const canvasDal = new CanvasDalImpl(db);
  const jobQueue = new JobQueueImpl(db);
  const presenceDal = new PresenceDalImpl(db);

  const tyrumHome =
    config.tyrumHome ??
    process.env["TYRUM_HOME"]?.trim() ??
    join(homedir(), ".tyrum");
  const artifactStore = createArtifactStoreFromEnv(tyrumHome, redactionEngine);
  const artifactMetadataDal = new ArtifactMetadataDalImpl(db);
  const nodeDal = new NodeDalImpl(db);
  const policySnapshotDal = new PolicySnapshotDalImpl(db);
  const authProfileDal = new AuthProfileDalImpl(db);

  return {
    db,
    memoryDal,
    eventLog,
    discoveryPipeline,
    riskClassifier,
    sessionDal,
    eventBus,
    telegramBot,
    approvalDal,
    watcherProcessor,
    canvasDal,
    jobQueue,
    presenceDal,
    redactionEngine,
    artifactStore,
    artifactMetadataDal,
    nodeDal,
    policySnapshotDal,
    authProfileDal,
    logger,
    config,
  };
}
