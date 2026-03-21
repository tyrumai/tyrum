import type { AgentsApi } from "./agents.js";
import type { AgentConfigApi } from "./agent-config.js";
import type { AuthPinsApi, AuthProfilesApi } from "./auth.js";
import type { AuthTokensApi } from "./auth-tokens.js";
import type { AgentListApi } from "./agent-list.js";
import type { AgentStatusApi } from "./agent-status.js";
import type { ArtifactsApi } from "./artifacts.js";
import type { AuditApi } from "./audit.js";
import type { ChannelConfigApi } from "./channel-config.js";
import type { ContractsApi } from "./contracts.js";
import type { ContextApi } from "./context.js";
import {
  type DesktopEnvironmentHostsApi,
  type DesktopEnvironmentsApi,
} from "./desktop-environments.js";
import type { DeviceTokensApi } from "./device-tokens.js";
import type { ExtensionsApi } from "./extensions.js";
import type { HealthApi } from "./health.js";
import type { LocationApi } from "./location.js";
import type { MemoryApi } from "./memory.js";
import type { ModelsApi } from "./models.js";
import type { ModelConfigApi } from "./model-config.js";
import {
  type NodesApi,
  type PairingsApi,
  type PresenceApi,
  type StatusApi,
  type UsageApi,
} from "./observability.js";
import type { PluginsApi } from "./plugins.js";
import type { PolicyApi } from "./policy.js";
import type { PolicyConfigApi } from "./policy-config.js";
import type { ProviderConfigApi } from "./provider-config.js";
import type { RoutingConfigApi } from "./routing-config.js";
import type { SecretsApi } from "./secrets.js";
import type { SchedulesApi } from "./schedules.js";
import type { ToolRegistryApi } from "./tool-registry.js";
import { createGeneratedTyrumHttpClient } from "./generated/client.generated.js";
import type { TyrumHttpClientOptions } from "./shared.js";

export interface TyrumHttpClient {
  authTokens: AuthTokensApi;
  deviceTokens: DeviceTokensApi;
  secrets: SecretsApi;
  policy: PolicyApi;
  authProfiles: AuthProfilesApi;
  authPins: AuthPinsApi;
  plugins: PluginsApi;
  contracts: ContractsApi;
  models: ModelsApi;
  providerConfig: ProviderConfigApi;
  modelConfig: ModelConfigApi;
  status: StatusApi;
  usage: UsageApi;
  presence: PresenceApi;
  nodes: NodesApi;
  pairings: PairingsApi;
  desktopEnvironmentHosts?: DesktopEnvironmentHostsApi;
  desktopEnvironments?: DesktopEnvironmentsApi;
  /**
   * Operator/admin surfaces.
   *
   * These are optional to preserve compatibility for consumers that mock or
   * dependency-inject a partial HTTP client.
   */
  agents?: AgentsApi;
  agentConfig?: AgentConfigApi;
  agentList?: AgentListApi;
  agentStatus?: AgentStatusApi;
  channelConfig?: ChannelConfigApi;
  routingConfig?: RoutingConfigApi;
  audit?: AuditApi;
  context?: ContextApi;
  artifacts?: ArtifactsApi;
  health?: HealthApi;
  toolRegistry?: ToolRegistryApi;
  extensions?: ExtensionsApi;
  memory?: MemoryApi;
  policyConfig?: PolicyConfigApi;
  location?: LocationApi;
  schedules?: SchedulesApi;
}

export type TyrumHttpClientOperator = TyrumHttpClient & {
  agents: AgentsApi;
  agentConfig: AgentConfigApi;
  agentList: AgentListApi;
  agentStatus: AgentStatusApi;
  channelConfig: ChannelConfigApi;
  routingConfig: RoutingConfigApi;
  audit: AuditApi;
  context: ContextApi;
  artifacts: ArtifactsApi;
  health: HealthApi;
  toolRegistry: ToolRegistryApi;
  extensions: ExtensionsApi;
  memory: MemoryApi;
  policyConfig: PolicyConfigApi;
  location: LocationApi;
  schedules: SchedulesApi;
  desktopEnvironmentHosts: DesktopEnvironmentHostsApi;
  desktopEnvironments: DesktopEnvironmentsApi;
};

export function createTyrumHttpClient(options: TyrumHttpClientOptions): TyrumHttpClientOperator {
  return createGeneratedTyrumHttpClient(options);
}

export type { TyrumHttpClientOptions } from "./shared.js";
