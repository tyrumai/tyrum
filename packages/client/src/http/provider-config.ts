import {
  ConfiguredProviderListResponse,
  ModelConfigDeleteConflictResponse,
  ModelConfigDeleteRequest,
  ModelConfigDeleteResponse,
  ProviderAccountCreateRequest,
  ProviderAccountMutateResponse,
  ProviderAccountUpdateRequest,
  ProviderRegistryResponse,
} from "@tyrum/schemas";
import { z } from "zod";
import {
  HttpTransport,
  NonEmptyString,
  validateOrThrow,
  type TyrumRequestOptions,
} from "./shared.js";

const ProviderPathKey = NonEmptyString;

export type ProviderRegistryResult = z.output<typeof ProviderRegistryResponse>;
export type ConfiguredProviderListResult = z.output<typeof ConfiguredProviderListResponse>;
export type ProviderAccountCreateInput = z.input<typeof ProviderAccountCreateRequest>;
export type ProviderAccountUpdateInput = z.input<typeof ProviderAccountUpdateRequest>;
export type ProviderDeleteInput = z.input<typeof ModelConfigDeleteRequest>;
export type ProviderDeleteResult =
  | z.output<typeof ModelConfigDeleteResponse>
  | z.output<typeof ModelConfigDeleteConflictResponse>;

async function parseDeleteResponse(response: Response): Promise<ProviderDeleteResult> {
  const body = (await response.json().catch(() => undefined)) as unknown;
  if (response.status === 409) {
    return validateOrThrow(
      ModelConfigDeleteConflictResponse,
      body,
      "provider delete conflict response",
    );
  }
  return validateOrThrow(ModelConfigDeleteResponse, body, "provider delete response");
}

export interface ProviderConfigApi {
  listRegistry(options?: TyrumRequestOptions): Promise<ProviderRegistryResult>;
  listProviders(options?: TyrumRequestOptions): Promise<ConfiguredProviderListResult>;
  createAccount(
    input: ProviderAccountCreateInput,
    options?: TyrumRequestOptions,
  ): Promise<z.output<typeof ProviderAccountMutateResponse>>;
  updateAccount(
    accountKey: string,
    input: ProviderAccountUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<z.output<typeof ProviderAccountMutateResponse>>;
  deleteAccount(
    accountKey: string,
    options?: TyrumRequestOptions,
  ): Promise<z.output<typeof ModelConfigDeleteResponse>>;
  deleteProvider(
    providerKey: string,
    input?: ProviderDeleteInput,
    options?: TyrumRequestOptions,
  ): Promise<ProviderDeleteResult>;
}

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
      return await parseDeleteResponse(response);
    },
  };
}
