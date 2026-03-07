import type { Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import type { GatewayContainer } from "../container.js";
import type { AgentRegistry } from "../modules/agent/registry.js";
import type { AuthTokenService } from "../modules/auth/auth-token-service.js";
import type { SlidingWindowRateLimiter } from "../modules/auth/rate-limiter.js";
import type { ApprovalEngineActionProcessor } from "../modules/approval/engine-action-processor.js";
import type { WsNotifier } from "../modules/approval/notifier.js";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { ConnectionDirectoryDal } from "../modules/backplane/connection-directory.js";
import type { OutboxPoller } from "../modules/backplane/outbox-poller.js";
import type { TelegramChannelProcessor } from "../modules/channels/telegram.js";
import type { ExecutionEngine } from "../modules/execution/engine.js";
import type { ExecutionWorkerLoop } from "../modules/execution/worker-loop.js";
import type { loadLifecycleHooksFromHome } from "../modules/hooks/config.js";
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

export type GatewayServer = HttpServer | HttpsServer;
export type SecretProviderForTenant = Awaited<
  ReturnType<typeof createDbSecretProviderFactory>
>["secretProviderForTenant"];
export type LifecycleHooks = Awaited<ReturnType<typeof loadLifecycleHooksFromHome>>;

export interface GatewayBootContext {
  instanceId: string;
  role: GatewayRole;
  tyrumHome: string;
  host: string;
  port: number;
  dbPath: string;
  migrationsDir: string;
  isLocalOnly: boolean;
  shouldRunEdge: boolean;
  shouldRunWorker: boolean;
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
  wsEngine?: ExecutionEngine;
  edgeEngine?: ExecutionEngine;
  hooksRuntime?: LifecycleHooksRuntime;
  approvalEngineActionProcessor?: ApprovalEngineActionProcessor;
  taskResults: TaskResultRegistry;
  protocolDeps: ProtocolDeps;
  approvalNotifier: WsNotifier;
}

export interface EdgeRuntime {
  plugins?: PluginRegistry;
  pluginCatalogProvider?: PluginCatalogProvider;
  agents?: AgentRegistry;
  authRateLimiter?: SlidingWindowRateLimiter;
  wsUpgradeRateLimiter?: SlidingWindowRateLimiter;
  wsHandler?: ReturnType<typeof createWsHandler>;
  outboxPoller?: OutboxPoller;
  telegramProcessor?: TelegramChannelProcessor;
  server?: GatewayServer;
}

export interface GatewayRuntime {
  background: BackgroundSchedulers;
  protocol: ProtocolRuntime;
  edge: EdgeRuntime;
  workerLoop?: ExecutionWorkerLoop;
  otel: OtelRuntime;
}
