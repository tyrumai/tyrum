import type { ConnectionManager } from "../connection-manager.js";
import type { OutboxDal } from "../../app/modules/backplane/outbox-dal.js";
import type { ConnectionDirectoryDal } from "../../app/modules/backplane/connection-directory.js";
import type { ApprovalDal } from "../../app/modules/approval/dal.js";
import type { PresenceDal } from "../../app/modules/presence/dal.js";
import type { ContextReportDal } from "../../app/modules/context/report-dal.js";
import type { PolicyOverrideDal } from "../../app/modules/policy/override-dal.js";
import type { NodePairingDal } from "../../app/modules/node/pairing-dal.js";
import type { AgentRegistry } from "../../app/modules/agent/registry.js";
import type { TurnController } from "../../app/modules/agent/turn-controller.js";
import type { WorkflowRunRunner } from "../../app/modules/workflow-run/runner.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { PluginRegistry } from "../../app/modules/plugins/registry.js";
import type { PluginCatalogProvider } from "../../app/modules/plugins/catalog-provider.js";
import type { LifecycleHooksRuntime } from "../../app/modules/hooks/runtime.js";
import type { Logger } from "../../app/modules/observability/logger.js";
import type { SqlDb, StateStoreKind } from "../../statestore/types.js";
import type { ModelsDevService } from "../../app/modules/models/models-dev-service.js";
import type { ModelCatalogService } from "../../app/modules/models/model-catalog-service.js";
import type { AuthAudit } from "../../app/modules/auth/audit.js";
import type { RedactionEngine } from "../../app/modules/redaction/engine.js";
import type { WsEventDal } from "../../app/modules/ws-event/dal.js";
import type { TaskResultRegistry } from "./task-result-registry.js";
import type { WsMessageEnvelope } from "@tyrum/contracts";
import type { IdentityScopeDal } from "../../app/modules/identity/scope.js";
import type { LocationService } from "../../app/modules/location/service.js";
import type { ArtifactStore } from "../../app/modules/artifact/store.js";
import type { DesktopEnvironmentDal } from "../../app/modules/desktop-environments/dal.js";

export type ProtocolRequestEnvelope = Extract<
  WsMessageEnvelope,
  { request_id: string; payload: unknown }
>;

export type ProtocolResponseEnvelope = Extract<WsMessageEnvelope, { ok: boolean }>;

export interface ProtocolDeps {
  connectionManager: ConnectionManager;
  logger?: Logger;
  authAudit?: AuthAudit;
  db?: SqlDb;
  wsEventDal?: WsEventDal;
  identityScopeDal?: IdentityScopeDal;
  locationService?: LocationService;
  artifactStore?: ArtifactStore;
  artifactMaxUploadBytes?: number;
  redactionEngine?: RedactionEngine;
  contextReportDal?: ContextReportDal;
  runtime?: {
    version: string;
    instanceId: string;
    role: string;
    dbKind: StateStoreKind;
    isExposed: boolean;
    otelEnabled: boolean;
    authEnabled?: boolean;
    toolrunnerHardeningProfile?: "baseline" | "hardened";
  };
  approvalDal?: ApprovalDal;
  desktopEnvironmentDal?: DesktopEnvironmentDal;
  presenceDal?: PresenceDal;
  policyOverrideDal?: PolicyOverrideDal;
  nodePairingDal?: NodePairingDal;
  agents?: AgentRegistry;
  turnController?: TurnController;
  workflowRunner?: WorkflowRunRunner;
  policyService?: PolicyService;
  plugins?: PluginRegistry;
  pluginCatalogProvider?: PluginCatalogProvider;
  modelsDev?: ModelsDevService;
  modelCatalog?: ModelCatalogService;
  hooks?: LifecycleHooksRuntime;
  presenceTtlMs?: number;
  maxBufferedBytes?: number;

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
}
