import type { ClientCapability } from "@tyrum/contracts";
import type { DeviceIdentity } from "@tyrum/transport-sdk/browser";
import type { OperatorAuthStrategy } from "./auth.js";
import type { OperatorHttpClient, OperatorWsClient } from "./deps.js";
import type { AutoSyncState } from "./auto-sync.js";
import type { ChatStore } from "./stores/chat-store.js";
import type { ConnectionStore } from "./stores/connection-store.js";
import type { ElevatedModeStore } from "./stores/elevated-mode-store.js";
import type { ActivityStore } from "./stores/activity-store.js";
import type { AgentStatusStore } from "./stores/agent-status-store.js";
import type { ApprovalsStore } from "./stores/approvals-store.js";
import type { DesktopEnvironmentHostsStore } from "./stores/desktop-environment-hosts-store.js";
import type { DesktopEnvironmentsStore } from "./stores/desktop-environments-store.js";
import type { PairingStore } from "./stores/pairing-store.js";
import type { RunsStore } from "./stores/runs-store.js";
import type { StatusStore } from "./stores/status-store.js";
import type { WorkboardStore } from "./stores/workboard-store.js";
import type { ExternalStore } from "./store.js";

export interface OperatorCoreOptions {
  wsUrl: string;
  httpBaseUrl: string;
  auth: OperatorAuthStrategy;
  capabilities?: ClientCapability[];
  deviceIdentity?: DeviceIdentity;
  elevatedModeStore?: ElevatedModeStore;
  deps?: {
    ws?: OperatorWsClient;
    http?: Partial<OperatorHttpClient>;
    createPrivilegedWs?: () => OperatorWsClient | null;
    createPrivilegedHttp?: () => OperatorHttpClient | null;
  };
}

export interface OperatorCore {
  wsUrl: string;
  httpBaseUrl: string;
  deviceId?: string | null;
  ws: OperatorWsClient;
  http: OperatorHttpClient;
  elevatedModeStore: ElevatedModeStore;
  connectionStore: ConnectionStore;
  autoSyncStore: ExternalStore<AutoSyncState>;
  approvalsStore: ApprovalsStore;
  runsStore: RunsStore;
  pairingStore: PairingStore;
  statusStore: StatusStore;
  workboardStore: WorkboardStore;
  agentStatusStore: AgentStatusStore;
  desktopEnvironmentHostsStore: DesktopEnvironmentHostsStore;
  desktopEnvironmentsStore: DesktopEnvironmentsStore;
  chatStore: ChatStore;
  activityStore: ActivityStore;
  syncAllNow(): Promise<void>;
  connect(): void;
  disconnect(): void;
  dispose(): void;
}
