// GENERATED: pnpm api:generate

import type { ProviderConfigApi } from "../provider-config.js";
import {
  ConfiguredProviderListResponse,
  ModelConfigDeleteRequest,
  ModelConfigDeleteResponse,
  ProviderAccountCreateRequest,
  ProviderAccountMutateResponse,
  ProviderAccountUpdateRequest,
  ProviderRegistryResponse,
} from "@tyrum/contracts";
import { HttpTransport, NonEmptyString, validateOrThrow } from "../shared.js";
import { parseModelConfigDeleteResponse } from "../config-delete-response.js";

const ProviderPathKey = NonEmptyString;
export function createProviderConfigApi(transport: HttpTransport): ProviderConfigApi {
  return {
    async listRegistry(options) {
      return await transport.request({
        method: "GET",
        path: "/config/providers/registry",
        response: ProviderRegistryResponse,
        signal: options?.signal,
      });
    },

    async listProviders(options) {
      return await transport.request({
        method: "GET",
        path: "/config/providers",
        response: ConfiguredProviderListResponse,
        signal: options?.signal,
      });
    },

    async createAccount(input, options) {
      const body = validateOrThrow(
        ProviderAccountCreateRequest,
        input,
        "provider account create request",
      );
      return await transport.request({
        method: "POST",
        path: "/config/providers/accounts",
        body,
        response: ProviderAccountMutateResponse,
        expectedStatus: 201,
        signal: options?.signal,
      });
    },

    async updateAccount(accountKey, input, options) {
      const parsedAccountKey = validateOrThrow(ProviderPathKey, accountKey, "provider account key");
      const body = validateOrThrow(
        ProviderAccountUpdateRequest,
        input,
        "provider account update request",
      );
      return await transport.request({
        method: "PATCH",
        path: `/config/providers/accounts/${encodeURIComponent(parsedAccountKey)}`,
        body,
        response: ProviderAccountMutateResponse,
        signal: options?.signal,
      });
    },

    async deleteAccount(accountKey, options) {
      const parsedAccountKey = validateOrThrow(ProviderPathKey, accountKey, "provider account key");
      return await transport.request({
        method: "DELETE",
        path: `/config/providers/accounts/${encodeURIComponent(parsedAccountKey)}`,
        response: ModelConfigDeleteResponse,
        signal: options?.signal,
      });
    },

    async deleteProvider(providerKey, input, options) {
      const parsedProviderKey = validateOrThrow(ProviderPathKey, providerKey, "provider key");
      const body = input
        ? validateOrThrow(ModelConfigDeleteRequest, input, "provider delete request")
        : undefined;
      const response = await transport.requestRaw({
        method: "DELETE",
        path: `/config/providers/${encodeURIComponent(parsedProviderKey)}`,
        body,
        expectedStatus: [200, 409],
        signal: options?.signal,
      });
      return await parseModelConfigDeleteResponse(response, {
        conflictContext: "provider delete conflict response",
        responseContext: "provider delete response",
      });
    },
  };
}
