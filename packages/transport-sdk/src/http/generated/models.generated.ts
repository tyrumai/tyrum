// GENERATED: pnpm api:generate

import type { ModelsApi } from "../models.js";
import { HttpTransport, validateOrThrow } from "../shared.js";
import {
  ModelsHttpProviderDetailResponse,
  ModelsHttpProviderListResponse,
  ModelsHttpProviderModelsResponse,
  ModelsHttpStatusResponse,
} from "@tyrum/contracts";
import { z } from "zod";

const ProviderIdPath = z.string().trim().min(1);
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
