import { ModelsDevProvider } from "@tyrum/schemas";
import { z } from "zod";
import { HttpTransport, validateOrThrow } from "./shared.js";

const ProviderIdPath = z.string().trim().min(1);

const ModelsStatusResponse = z
  .object({
    status: z.literal("ok"),
    models_dev: z.unknown(),
  })
  .strict();

const ModelsProviderSummary = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    npm: z.string().trim().min(1).nullable(),
    api: z.string().trim().min(1).nullable(),
    env: z.array(z.string().trim().min(1)),
    doc: z.string().trim().min(1).nullable(),
    model_count: z.number().int().nonnegative(),
  })
  .strict();

const ModelsProviderListResponse = z
  .object({
    status: z.literal("ok"),
    models_dev: z.unknown(),
    providers: z.array(ModelsProviderSummary),
  })
  .strict();

const ModelsProviderDetailResponse = z
  .object({
    status: z.literal("ok"),
    models_dev: z.unknown(),
    provider: ModelsDevProvider,
  })
  .strict();

const ModelsProviderModelSummary = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    family: z.string().trim().min(1).nullable(),
    release_date: z.string().trim().min(1).nullable(),
    last_updated: z.string().trim().min(1).nullable(),
    attachment: z.boolean().nullable(),
    reasoning: z.boolean().nullable(),
    tool_call: z.boolean().nullable(),
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])).optional(),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])).optional(),
      })
      .nullable(),
    limit: z.record(z.string(), z.number()).nullable(),
  })
  .strict();

const ModelsProviderModelsResponse = z
  .object({
    status: z.literal("ok"),
    models_dev: z.unknown(),
    provider: z
      .object({
        id: z.string().trim().min(1),
        name: z.string().trim().min(1),
        npm: z.string().trim().min(1).nullable(),
      })
      .strict(),
    models: z.array(ModelsProviderModelSummary),
  })
  .strict();

export type ModelsStatusResponse = z.infer<typeof ModelsStatusResponse>;
export type ModelsProviderListResponse = z.infer<typeof ModelsProviderListResponse>;
export type ModelsProviderDetailResponse = z.infer<typeof ModelsProviderDetailResponse>;
export type ModelsProviderModelsResponse = z.infer<typeof ModelsProviderModelsResponse>;

export interface ModelsApi {
  status(): Promise<ModelsStatusResponse>;
  refresh(): Promise<ModelsStatusResponse>;
  listProviders(): Promise<ModelsProviderListResponse>;
  getProvider(providerId: string): Promise<ModelsProviderDetailResponse>;
  listProviderModels(providerId: string): Promise<ModelsProviderModelsResponse>;
}

export function createModelsApi(transport: HttpTransport): ModelsApi {
  return {
    async status() {
      return await transport.request({
        method: "GET",
        path: "/models/status",
        response: ModelsStatusResponse,
      });
    },

    async refresh() {
      return await transport.request({
        method: "POST",
        path: "/models/refresh",
        response: ModelsStatusResponse,
      });
    },

    async listProviders() {
      return await transport.request({
        method: "GET",
        path: "/models/providers",
        response: ModelsProviderListResponse,
      });
    },

    async getProvider(providerId) {
      const parsedProviderId = validateOrThrow(ProviderIdPath, providerId, "provider id");
      return await transport.request({
        method: "GET",
        path: `/models/providers/${encodeURIComponent(parsedProviderId)}`,
        response: ModelsProviderDetailResponse,
      });
    },

    async listProviderModels(providerId) {
      const parsedProviderId = validateOrThrow(ProviderIdPath, providerId, "provider id");
      return await transport.request({
        method: "GET",
        path: `/models/providers/${encodeURIComponent(parsedProviderId)}/models`,
        response: ModelsProviderModelsResponse,
      });
    },
  };
}
