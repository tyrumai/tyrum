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
import { RedactionEngine } from "./modules/redaction/engine.js";
import type { ArtifactStore } from "./modules/artifact/store.js";
import { FsArtifactStore, S3ArtifactStore } from "./modules/artifact/store.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { Logger } from "./modules/observability/logger.js";
import { SqliteDb } from "./statestore/sqlite.js";
import { PostgresDb } from "./statestore/postgres.js";

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
  redactionEngine: RedactionEngine;
  artifactStore: ArtifactStore;
  logger: Logger;
  config: GatewayConfig;
}

function isPostgresDbUri(dbPath: string): boolean {
  return /^postgres(ql)?:\/\//i.test(dbPath.trim());
}

export async function createContainer(
  config: GatewayConfig,
  opts?: { redactionEngine?: RedactionEngine },
): Promise<GatewayContainer> {
  const db = isPostgresDbUri(config.dbPath)
    ? await PostgresDb.open({ dbUri: config.dbPath, migrationsDir: config.migrationsDir })
    : SqliteDb.open({ dbPath: config.dbPath, migrationsDir: config.migrationsDir });

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

  const artifactStore = createArtifactStore(config, redactionEngine);

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
    redactionEngine,
    artifactStore,
    logger,
    config,
  };
}

function createArtifactStore(
  config: GatewayConfig,
  redactionEngine: RedactionEngine,
): ArtifactStore {
  const kind = process.env["TYRUM_ARTIFACT_STORE"]?.trim() || "fs";
  const tyrumHome =
    config.tyrumHome ??
    process.env["TYRUM_HOME"]?.trim() ??
    join(homedir(), ".tyrum");
  const fsDir =
    process.env["TYRUM_ARTIFACTS_DIR"]?.trim() || join(tyrumHome, "artifacts");

  if (kind === "s3") {
    const bucket =
      process.env["TYRUM_ARTIFACTS_S3_BUCKET"]?.trim() || "tyrum-artifacts";
    const region =
      process.env["TYRUM_ARTIFACTS_S3_REGION"]?.trim() ||
      "us-east-1";
    const endpoint = process.env["TYRUM_ARTIFACTS_S3_ENDPOINT"]?.trim() || undefined;
    const forcePathStyleRaw =
      process.env["TYRUM_ARTIFACTS_S3_FORCE_PATH_STYLE"]?.trim();
    const forcePathStyle =
      forcePathStyleRaw !== undefined
        ? forcePathStyleRaw === "1" || forcePathStyleRaw.toLowerCase() === "true"
        : endpoint !== undefined;

    const accessKeyId =
      process.env["TYRUM_ARTIFACTS_S3_ACCESS_KEY_ID"]?.trim() || undefined;
    const secretAccessKey =
      process.env["TYRUM_ARTIFACTS_S3_SECRET_ACCESS_KEY"]?.trim() || undefined;
    const sessionToken =
      process.env["TYRUM_ARTIFACTS_S3_SESSION_TOKEN"]?.trim() || undefined;

    const client = new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey, sessionToken }
          : undefined,
    });
    return new S3ArtifactStore(client, bucket, "artifacts", redactionEngine);
  }

  return new FsArtifactStore(fsDir, redactionEngine);
}
