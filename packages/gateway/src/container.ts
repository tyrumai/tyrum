/**
 * Dependency injection container — plain constructor injection.
 *
 * Creates and wires all module instances from a configuration object.
 */

import type Database from "better-sqlite3";
import type { EventBus } from "./event-bus.js";
import type { MemoryDal } from "./modules/memory/dal.js";
import type { EventLog } from "./modules/planner/event-log.js";
import type { DiscoveryPipeline } from "./modules/discovery/pipeline.js";
import type { RiskClassifier } from "./modules/risk/classifier.js";
import type { SessionDal } from "./modules/agent/session-dal.js";

import { createDatabase } from "./db.js";
import { migrate } from "./migrate.js";
import { createEventBus } from "./event-bus.js";
import { MemoryDal as MemoryDalImpl } from "./modules/memory/dal.js";
import { EventLog as EventLogImpl } from "./modules/planner/event-log.js";
import {
  DiscoveryPipeline as DiscoveryPipelineImpl,
  InMemoryConnectorCache,
} from "./modules/discovery/pipeline.js";
import {
  RiskClassifier as RiskClassifierImpl,
  defaultRiskConfig,
} from "./modules/risk/classifier.js";
import { SessionDal as SessionDalImpl } from "./modules/agent/session-dal.js";

export interface GatewayConfig {
  dbPath: string;
  migrationsDir: string;
  modelGatewayConfigPath?: string;
}

export interface GatewayContainer {
  db: Database.Database;
  memoryDal: MemoryDal;
  eventLog: EventLog;
  discoveryPipeline: DiscoveryPipeline;
  riskClassifier: RiskClassifier;
  sessionDal: SessionDal;
  eventBus: EventBus;
  config: GatewayConfig;
}

export function createContainer(config: GatewayConfig): GatewayContainer {
  const db = createDatabase(config.dbPath);
  migrate(db, config.migrationsDir);

  const memoryDal = new MemoryDalImpl(db);
  const eventLog = new EventLogImpl(db);
  const connectorCache = new InMemoryConnectorCache();
  const discoveryPipeline = new DiscoveryPipelineImpl(connectorCache);
  const riskClassifier = new RiskClassifierImpl(defaultRiskConfig());
  const sessionDal = new SessionDalImpl(db);
  const eventBus = createEventBus();

  return {
    db,
    memoryDal,
    eventLog,
    discoveryPipeline,
    riskClassifier,
    sessionDal,
    eventBus,
    config,
  };
}
