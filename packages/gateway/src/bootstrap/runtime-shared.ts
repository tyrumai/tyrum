import type { Server as HttpServer } from "node:http";
import type { GatewayContainer } from "../container.js";
import type { AgentRegistry } from "../modules/agent/registry.js";
import type { AuthTokenService } from "../modules/auth/auth-token-service.js";
import type { SlidingWindowRateLimiter } from "../modules/auth/rate-limiter.js";
import type { ApprovalEngineActionProcessor } from "../modules/approval/engine-action-processor.js";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { ConnectionDirectoryDal } from "../modules/backplane/connection-directory.js";
import type { OutboxPoller } from "../modules/backplane/outbox-poller.js";
import type { GuardianReviewProcessor } from "../modules/review/guardian-review-processor.js";
import type { DiscordChannelMonitor } from "../modules/channels/discord-monitor.js";
import type { TelegramChannelProcessor } from "../modules/channels/telegram.js";
import type { TelegramPollingMonitor } from "../modules/channels/telegram-polling-monitor.js";
import type { TurnController } from "../modules/agent/runtime/turn-controller.js";
import type { ExecutionWorkerLoop } from "../modules/execution/worker-loop.js";
import type { WorkflowRunRunner } from "../modules/workflow-run/runner.js";
import type { ConversationTurnLoop } from "../modules/agent/runtime/conversation-turn-loop.js";
import type { LifecycleHookDefinition as LifecycleHookDefinitionT } from "@tyrum/contracts";
import type { LifecycleHooksRuntime } from "../modules/hooks/runtime.js";
import type { OtelRuntime } from "../modules/observability/otel.js";
import type { PluginRegistry } from "../modules/plugins/registry.js";
import type { PluginCatalogProvider } from "../modules/plugins/catalog-provider.js";
import type { createDbSecretProviderFactory } from "../modules/secret/create-secret-provider.js";
import type { WatcherScheduler } from "../modules/watcher/scheduler.js";
import type { WorkSignalScheduler } from "../modules/workboard/signal-scheduler.js";
import type { createWsHandler } from "../routes/ws.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { ProtocolDeps } from "../ws/protocol.js";
import type { TaskResultRegistry } from "../ws/protocol/task-result-registry.js";
import type { GatewayRole } from "./network.js";
import type { ArtifactLifecycleScheduler } from "../modules/artifact/lifecycle.js";
import type { OutboxLifecycleScheduler } from "../modules/backplane/outbox-lifecycle.js";
import type { StateStoreLifecycleScheduler } from "../modules/statestore/lifecycle.js";
import type { DesktopEnvironmentHostRuntime } from "../modules/desktop-environments/host-runtime.js";
import type { LocalDesktopGatewayWsBridge } from "../modules/desktop-environments/local-gateway-ws-bridge.js";
import type { WorkboardOrchestrator } from "../modules/workboard/orchestrator.js";
import type { WorkboardDispatcher } from "../modules/workboard/dispatcher.js";
import type { WorkboardReconciler } from "../modules/workboard/reconciler.js";
import type { SubagentJanitor } from "../modules/workboard/subagent-janitor.js";

export type GatewayServer = HttpServer;
export type SecretProviderForTenant = Awaited<
  ReturnType<typeof createDbSecretProviderFactory>
>["secretProviderForTenant"];
export type LifecycleHooks = readonly LifecycleHookDefinitionT[];

export interface GatewayBootContext {
  instanceId: string;
  role: GatewayRole;
  tyrumHome: string;
  host: string;
  port: number;
  desktopTakeoverAdvertiseOrigin?: string;
  dbPath: string;
  migrationsDir: string;
  isLocalOnly: boolean;
  shouldRunEdge: boolean;
  shouldRunWorker: boolean;
  shouldRunDesktopRuntime: boolean;
  deploymentConfig: GatewayContainer["deploymentConfig"];
  container: GatewayContainer;
  logger: GatewayContainer["logger"];
  authTokens: AuthTokenService;
  secretProviderForTenant: SecretProviderForTenant;
  lifecycleHooks: LifecycleHooks;
}

export interface BackgroundSchedulers {
  watcherScheduler?: WatcherScheduler;
  artifactLifecycleScheduler?: ArtifactLifecycleScheduler;
  outboxLifecycleScheduler?: OutboxLifecycleScheduler;
  stateStoreLifecycleScheduler?: StateStoreLifecycleScheduler;
}

export interface ProtocolRuntime {
  connectionManager: ConnectionManager;
  connectionDirectory: ConnectionDirectoryDal;
  outboxDal: OutboxDal;
  workSignalScheduler?: WorkSignalScheduler;
  turnController?: TurnController;
  workflowRunner?: WorkflowRunRunner;
  hooksRuntime?: LifecycleHooksRuntime;
  approvalEngineActionProcessor?: ApprovalEngineActionProcessor;
  guardianReviewProcessor?: GuardianReviewProcessor;
  taskResults: TaskResultRegistry;
  protocolDeps: ProtocolDeps;
}

export interface EdgeRuntime {
  plugins?: PluginRegistry;
  pluginCatalogProvider?: PluginCatalogProvider;
  agents?: AgentRegistry;
  workboardOrchestrator?: WorkboardOrchestrator;
  workboardDispatcher?: WorkboardDispatcher;
  workboardReconciler?: WorkboardReconciler;
  subagentJanitor?: SubagentJanitor;
  authRateLimiter?: SlidingWindowRateLimiter;
  wsUpgradeRateLimiter?: SlidingWindowRateLimiter;
  wsHandler?: ReturnType<typeof createWsHandler>;
  outboxPoller?: OutboxPoller;
  telegramProcessor?: TelegramChannelProcessor;
  telegramPollingMonitor?: TelegramPollingMonitor;
  discordMonitor?: DiscordChannelMonitor;
  server?: GatewayServer;
}

export interface GatewayRuntime {
  background: BackgroundSchedulers;
  protocol: ProtocolRuntime;
  edge: EdgeRuntime;
  workerLoop?: ExecutionWorkerLoop;
  conversationLoop?: ConversationTurnLoop;
  desktopHostRuntime?: DesktopEnvironmentHostRuntime;
  desktopGatewayWsBridge?: LocalDesktopGatewayWsBridge;
  otel: OtelRuntime;
}
