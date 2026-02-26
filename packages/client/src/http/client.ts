import {
  createAuthPinsApi,
  createAuthProfilesApi,
  type AuthPinsApi,
  type AuthProfilesApi,
} from "./auth.js";
import { createAgentStatusApi, type AgentStatusApi } from "./agent-status.js";
import { createArtifactsApi, type ArtifactsApi } from "./artifacts.js";
import { createAuditApi, type AuditApi } from "./audit.js";
import { createContractsApi, type ContractsApi } from "./contracts.js";
import { createContextApi, type ContextApi } from "./context.js";
import { createDeviceTokensApi, type DeviceTokensApi } from "./device-tokens.js";
import { createHealthApi, type HealthApi } from "./health.js";
import { createModelsApi, type ModelsApi } from "./models.js";
import {
  createPairingsApi,
  createPresenceApi,
  createStatusApi,
  createUsageApi,
  type PairingsApi,
  type PresenceApi,
  type StatusApi,
  type UsageApi,
} from "./observability.js";
import { createPluginsApi, type PluginsApi } from "./plugins.js";
import { createPolicyApi, type PolicyApi } from "./policy.js";
import { createRoutingConfigApi, type RoutingConfigApi } from "./routing-config.js";
import { createSecretsApi, type SecretsApi } from "./secrets.js";
import { HttpTransport, type TyrumHttpClientOptions } from "./shared.js";

export interface TyrumHttpClient {
  deviceTokens: DeviceTokensApi;
  secrets: SecretsApi;
  policy: PolicyApi;
  authProfiles: AuthProfilesApi;
  authPins: AuthPinsApi;
  plugins: PluginsApi;
  contracts: ContractsApi;
  models: ModelsApi;
  status: StatusApi;
  usage: UsageApi;
  presence: PresenceApi;
  pairings: PairingsApi;
  /**
   * Operator/admin surfaces.
   *
   * These are optional to preserve compatibility for consumers that mock or
   * dependency-inject a partial HTTP client.
   */
  agentStatus?: AgentStatusApi;
  routingConfig?: RoutingConfigApi;
  audit?: AuditApi;
  context?: ContextApi;
  artifacts?: ArtifactsApi;
  health?: HealthApi;
}

export type TyrumHttpClientOperator = TyrumHttpClient & {
  agentStatus: AgentStatusApi;
  routingConfig: RoutingConfigApi;
  audit: AuditApi;
  context: ContextApi;
  artifacts: ArtifactsApi;
  health: HealthApi;
};

export function createTyrumHttpClient(options: TyrumHttpClientOptions): TyrumHttpClientOperator {
  const transport = new HttpTransport(options);

  return {
    deviceTokens: createDeviceTokensApi(transport),
    secrets: createSecretsApi(transport),
    policy: createPolicyApi(transport),
    authProfiles: createAuthProfilesApi(transport),
    authPins: createAuthPinsApi(transport),
    plugins: createPluginsApi(transport),
    contracts: createContractsApi(transport),
    models: createModelsApi(transport),
    status: createStatusApi(transport),
    usage: createUsageApi(transport),
    presence: createPresenceApi(transport),
    pairings: createPairingsApi(transport),
    agentStatus: createAgentStatusApi(transport),
    routingConfig: createRoutingConfigApi(transport),
    audit: createAuditApi(transport),
    context: createContextApi(transport),
    artifacts: createArtifactsApi(transport),
    health: createHealthApi(transport),
  };
}

export type { TyrumHttpClientOptions } from "./shared.js";
