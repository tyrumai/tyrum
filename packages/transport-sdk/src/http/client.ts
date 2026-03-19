import { createAgentsApi, type AgentsApi } from "./agents.js";
import { createAgentConfigApi, type AgentConfigApi } from "./agent-config.js";
import {
  createAuthPinsApi,
  createAuthProfilesApi,
  type AuthPinsApi,
  type AuthProfilesApi,
} from "./auth.js";
import { createAuthTokensApi, type AuthTokensApi } from "./auth-tokens.js";
import { createAgentListApi, type AgentListApi } from "./agent-list.js";
import { createAgentStatusApi, type AgentStatusApi } from "./agent-status.js";
import { createArtifactsApi, type ArtifactsApi } from "./artifacts.js";
import { createAuditApi, type AuditApi } from "./audit.js";
import { createChannelConfigApi, type ChannelConfigApi } from "./channel-config.js";
import { createContractsApi, type ContractsApi } from "./contracts.js";
import { createContextApi, type ContextApi } from "./context.js";
import {
  createDesktopEnvironmentHostsApi,
  createDesktopEnvironmentsApi,
  type DesktopEnvironmentHostsApi,
  type DesktopEnvironmentsApi,
} from "./desktop-environments.js";
import { createDeviceTokensApi, type DeviceTokensApi } from "./device-tokens.js";
import { createExtensionsApi, type ExtensionsApi } from "./extensions.js";
import { createHealthApi, type HealthApi } from "./health.js";
import { createLocationApi, type LocationApi } from "./location.js";
import { createModelsApi, type ModelsApi } from "./models.js";
import { createModelConfigApi, type ModelConfigApi } from "./model-config.js";
import {
  createNodesApi,
  createPairingsApi,
  createPresenceApi,
  createStatusApi,
  createUsageApi,
  type NodesApi,
  type PairingsApi,
  type PresenceApi,
  type StatusApi,
  type UsageApi,
} from "./observability.js";
import { createPluginsApi, type PluginsApi } from "./plugins.js";
import { createPolicyApi, type PolicyApi } from "./policy.js";
import { createPolicyConfigApi, type PolicyConfigApi } from "./policy-config.js";
import { createProviderConfigApi, type ProviderConfigApi } from "./provider-config.js";
import { createRoutingConfigApi, type RoutingConfigApi } from "./routing-config.js";
import { createSecretsApi, type SecretsApi } from "./secrets.js";
import { createToolRegistryApi, type ToolRegistryApi } from "./tool-registry.js";
import { HttpTransport, type TyrumHttpClientOptions } from "./shared.js";

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
  policyConfig?: PolicyConfigApi;
  location?: LocationApi;
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
  policyConfig: PolicyConfigApi;
  location: LocationApi;
  desktopEnvironmentHosts: DesktopEnvironmentHostsApi;
  desktopEnvironments: DesktopEnvironmentsApi;
};

export function createTyrumHttpClient(options: TyrumHttpClientOptions): TyrumHttpClientOperator {
  const transport = new HttpTransport(options);

  return {
    authTokens: createAuthTokensApi(transport),
    deviceTokens: createDeviceTokensApi(transport),
    secrets: createSecretsApi(transport),
    policy: createPolicyApi(transport),
    authProfiles: createAuthProfilesApi(transport),
    authPins: createAuthPinsApi(transport),
    plugins: createPluginsApi(transport),
    contracts: createContractsApi(transport),
    models: createModelsApi(transport),
    providerConfig: createProviderConfigApi(transport),
    modelConfig: createModelConfigApi(transport),
    status: createStatusApi(transport),
    usage: createUsageApi(transport),
    presence: createPresenceApi(transport),
    nodes: createNodesApi(transport),
    pairings: createPairingsApi(transport),
    desktopEnvironmentHosts: createDesktopEnvironmentHostsApi(transport),
    desktopEnvironments: createDesktopEnvironmentsApi(transport),
    agents: createAgentsApi(transport),
    agentConfig: createAgentConfigApi(transport),
    agentList: createAgentListApi(transport),
    agentStatus: createAgentStatusApi(transport),
    channelConfig: createChannelConfigApi(transport),
    routingConfig: createRoutingConfigApi(transport),
    audit: createAuditApi(transport),
    context: createContextApi(transport),
    artifacts: createArtifactsApi(transport),
    health: createHealthApi(transport),
    toolRegistry: createToolRegistryApi(transport),
    extensions: createExtensionsApi(transport),
    policyConfig: createPolicyConfigApi(transport),
    location: createLocationApi(transport),
  };
}

export type { TyrumHttpClientOptions } from "./shared.js";
