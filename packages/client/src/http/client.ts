import { createAuthPinsApi, createAuthProfilesApi, type AuthPinsApi, type AuthProfilesApi } from "./auth.js";
import { createContractsApi, type ContractsApi } from "./contracts.js";
import { createDeviceTokensApi, type DeviceTokensApi } from "./device-tokens.js";
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
}

export function createTyrumHttpClient(options: TyrumHttpClientOptions): TyrumHttpClient {
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
  };
}

export type { TyrumHttpClientOptions } from "./shared.js";
