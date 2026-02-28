import type { ConnectionManager } from "../connection-manager.js";
import type { OutboxDal } from "../../modules/backplane/outbox-dal.js";
import type { ConnectionDirectoryDal } from "../../modules/backplane/connection-directory.js";
import type { ApprovalDal } from "../../modules/approval/dal.js";
import type { PresenceDal } from "../../modules/presence/dal.js";
import type { ContextReportDal } from "../../modules/context/report-dal.js";
import type { PolicyOverrideDal } from "../../modules/policy/override-dal.js";
import type { NodePairingDal } from "../../modules/node/pairing-dal.js";
import type { AgentRegistry } from "../../modules/agent/registry.js";
import type { ExecutionEngine } from "../../modules/execution/engine.js";
import type { PolicyService } from "../../modules/policy/service.js";
import type { PluginRegistry } from "../../modules/plugins/registry.js";
import type { LifecycleHooksRuntime } from "../../modules/hooks/runtime.js";
import type { Logger } from "../../modules/observability/logger.js";
import type { SqlDb, StateStoreKind } from "../../statestore/types.js";
import type { ModelsDevService } from "../../modules/models/models-dev-service.js";
import type { AuthAudit } from "../../modules/auth/audit.js";
import type { MemoryV1Dal } from "../../modules/memory/v1-dal.js";
import type { ArtifactStore } from "../../modules/artifact/store.js";
import type { RedactionEngine } from "../../modules/redaction/engine.js";
import type { TaskResultRegistry } from "./task-result-registry.js";
import type { AgentConfig } from "@tyrum/schemas";

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

/**
 * External dependencies injected into the protocol handler so the module
 * stays unit-testable without real services.
 */
export interface ProtocolDeps {
  connectionManager: ConnectionManager;
  logger?: Logger;
  authAudit?: AuthAudit;
  db?: SqlDb;
  redactionEngine?: RedactionEngine;
  memoryV1Dal?: MemoryV1Dal;
  memoryV1BudgetsProvider?: (agentId?: string) => Promise<AgentConfig["memory"]["v1"]["budgets"]>;
  artifactStore?: ArtifactStore;
  contextReportDal?: ContextReportDal;
  runtime?: {
    version: string;
    instanceId: string;
    role: string;
    dbKind: StateStoreKind;
    isExposed: boolean;
    otelEnabled: boolean;
  };
  approvalDal?: ApprovalDal;
  presenceDal?: PresenceDal;
  policyOverrideDal?: PolicyOverrideDal;
  nodePairingDal?: NodePairingDal;
  agents?: AgentRegistry;
  engine?: ExecutionEngine;
  policyService?: PolicyService;
  plugins?: PluginRegistry;
  modelsDev?: ModelsDevService;
  hooks?: LifecycleHooksRuntime;
  presenceTtlMs?: number;

  /**
   * Optional cluster router. When configured, the gateway can deliver WS messages
   * to peers connected to other edge instances via the DB outbox + polling backplane.
   */
  cluster?: {
    edgeId: string;
    outboxDal: OutboxDal;
    connectionDirectory: ConnectionDirectoryDal;
  };

  taskResults?: TaskResultRegistry;

  /** Called when a task.execute response is received from a client. */
  onTaskResult?: (
    taskId: string,
    success: boolean,
    result: unknown,
    evidence: unknown,
    error: string | undefined,
  ) => void;

  /** Called when a WebSocket peer disconnects (best-effort). */
  onConnectionClosed?: (connectionId: string) => void;

  /** Called when an approval.request response is received from a client. */
  onApprovalDecision?: (approvalId: number, approved: boolean, reason: string | undefined) => void;
}
