// GENERATED: pnpm api:generate

import { HttpTransport, type TyrumHttpClientOptions } from "../shared.js";
import { createAgentConfigApi } from "./agent-config.generated.js";
import { createAgentListApi } from "./agent-list.generated.js";
import { createAgentStatusApi } from "./agent-status.generated.js";
import { createAgentsApi } from "./agents.generated.js";
import { createArtifactsApi } from "./artifacts.generated.js";
import { createAuditApi } from "./audit.generated.js";
import { createAuthPinsApi, createAuthProfilesApi } from "./auth.generated.js";
import { createAuthTokensApi } from "./auth-tokens.generated.js";
import { createChannelConfigApi } from "./channel-config.generated.js";
import { createContextApi } from "./context.generated.js";
import { createContractsApi } from "./contracts.generated.js";
import {
  createDesktopEnvironmentHostsApi,
  createDesktopEnvironmentsApi,
} from "./desktop-environments.generated.js";
import { createDeviceTokensApi } from "./device-tokens.generated.js";
import { createExtensionsApi } from "./extensions.generated.js";
import { createHealthApi } from "./health.generated.js";
import { createLocationApi } from "./location.generated.js";
import { createMemoryApi } from "./memory.generated.js";
import { createModelConfigApi } from "./model-config.generated.js";
import { createModelsApi } from "./models.generated.js";
import {
  createNodesApi,
  createPairingsApi,
  createPresenceApi,
  createStatusApi,
  createUsageApi,
} from "./observability.generated.js";
import { createPluginsApi } from "./plugins.generated.js";
import { createPolicyApi } from "./policy.generated.js";
import { createPolicyConfigApi } from "./policy-config.generated.js";
import { createProviderConfigApi } from "./provider-config.generated.js";
import { createRoutingConfigApi } from "./routing-config.generated.js";
import { createSchedulesApi } from "./schedules.generated.js";
import { createSecretsApi } from "./secrets.generated.js";
import { createToolRegistryApi } from "./tool-registry.generated.js";

export function createGeneratedTyrumHttpClient(options: TyrumHttpClientOptions) {
  const transport = new HttpTransport(options);
  return {
    agentConfig: createAgentConfigApi(transport),
    agentList: createAgentListApi(transport),
    agentStatus: createAgentStatusApi(transport),
    agents: createAgentsApi(transport),
    artifacts: createArtifactsApi(transport),
    audit: createAuditApi(transport),
    authPins: createAuthPinsApi(transport),
    authProfiles: createAuthProfilesApi(transport),
    authTokens: createAuthTokensApi(transport),
    channelConfig: createChannelConfigApi(transport),
    context: createContextApi(transport),
    contracts: createContractsApi(transport),
    desktopEnvironmentHosts: createDesktopEnvironmentHostsApi(transport),
    desktopEnvironments: createDesktopEnvironmentsApi(transport),
    deviceTokens: createDeviceTokensApi(transport),
    extensions: createExtensionsApi(transport),
    health: createHealthApi(transport),
    location: createLocationApi(transport),
    memory: createMemoryApi(transport),
    modelConfig: createModelConfigApi(transport),
    models: createModelsApi(transport),
    nodes: createNodesApi(transport),
    pairings: createPairingsApi(transport),
    plugins: createPluginsApi(transport),
    policy: createPolicyApi(transport),
    policyConfig: createPolicyConfigApi(transport),
    presence: createPresenceApi(transport),
    providerConfig: createProviderConfigApi(transport),
    routingConfig: createRoutingConfigApi(transport),
    schedules: createSchedulesApi(transport),
    secrets: createSecretsApi(transport),
    status: createStatusApi(transport),
    toolRegistry: createToolRegistryApi(transport),
    usage: createUsageApi(transport),
  };
}
