import {
  ModelsHttpProviderDetailResponse,
  ModelsHttpProviderListResponse,
  ModelsHttpProviderModelsResponse,
  ModelsHttpStatusResponse,
} from "@tyrum/contracts";
import { z } from "zod";
import { HttpTransport, validateOrThrow, type TyrumRequestOptions } from "./shared.js";

const ProviderIdPath = z.string().trim().min(1);

export type ModelsStatusResponse = z.infer<typeof ModelsHttpStatusResponse>;
export type ModelsProviderListResponse = z.infer<typeof ModelsHttpProviderListResponse>;
export type ModelsProviderDetailResponse = z.infer<typeof ModelsHttpProviderDetailResponse>;
export type ModelsProviderModelsResponse = z.infer<typeof ModelsHttpProviderModelsResponse>;

export interface ModelsApi {
  status(options?: TyrumRequestOptions): Promise<ModelsStatusResponse>;
  refresh(options?: TyrumRequestOptions): Promise<ModelsStatusResponse>;
  listProviders(options?: TyrumRequestOptions): Promise<ModelsProviderListResponse>;
  getProvider(
    providerId: string,
    options?: TyrumRequestOptions,
  ): Promise<ModelsProviderDetailResponse>;
  listProviderModels(
    providerId: string,
    options?: TyrumRequestOptions,
  ): Promise<ModelsProviderModelsResponse>;
}

export function createModelsApi(transport: HttpTransport): ModelsApi {
  return {
    async status(options) {
      return await transport.request({
        method: "GET",
        path: "/models/status",
        response: ModelsHttpStatusResponse,
        signal: options?.signal,
      });
    },

    async refresh(options) {
      return await transport.request({
        method: "POST",
        path: "/models/refresh",
        response: ModelsHttpStatusResponse,
        signal: options?.signal,
      });
    },

    async listProviders(options) {
      return await transport.request({
        method: "GET",
        path: "/models/providers",
        response: ModelsHttpProviderListResponse,
        signal: options?.signal,
      });
    },

    async getProvider(providerId, options) {
      const parsedProviderId = validateOrThrow(ProviderIdPath, providerId, "provider id");
      return await transport.request({
        method: "GET",
        path: `/models/providers/${encodeURIComponent(parsedProviderId)}`,
        response: ModelsHttpProviderDetailResponse,
        signal: options?.signal,
      });
    },

    async listProviderModels(providerId, options) {
      const parsedProviderId = validateOrThrow(ProviderIdPath, providerId, "provider id");
      return await transport.request({
        method: "GET",
        path: `/models/providers/${encodeURIComponent(parsedProviderId)}/models`,
        response: ModelsHttpProviderModelsResponse,
        signal: options?.signal,
      });
    },
  };
}
