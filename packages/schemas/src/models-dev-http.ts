import { z } from "zod";
import { ModelsDevProvider } from "./models-dev.js";

export const ModelsHttpProviderSummary = z
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
export type ModelsHttpProviderSummary = z.infer<typeof ModelsHttpProviderSummary>;

export const ModelsHttpModelSummary = z
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
export type ModelsHttpModelSummary = z.infer<typeof ModelsHttpModelSummary>;

export const ModelsHttpStatusResponse = z
  .object({
    status: z.literal("ok"),
    models_dev: z.unknown(),
  })
  .strict();
export type ModelsHttpStatusResponse = z.infer<typeof ModelsHttpStatusResponse>;

export const ModelsHttpProviderListResponse = z
  .object({
    status: z.literal("ok"),
    models_dev: z.unknown(),
    providers: z.array(ModelsHttpProviderSummary),
  })
  .strict();
export type ModelsHttpProviderListResponse = z.infer<typeof ModelsHttpProviderListResponse>;

export const ModelsHttpProviderDetailResponse = z
  .object({
    status: z.literal("ok"),
    models_dev: z.unknown(),
    provider: ModelsDevProvider,
  })
  .strict();
export type ModelsHttpProviderDetailResponse = z.infer<typeof ModelsHttpProviderDetailResponse>;

export const ModelsHttpProviderModelsResponse = z
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
    models: z.array(ModelsHttpModelSummary),
  })
  .strict();
export type ModelsHttpProviderModelsResponse = z.infer<typeof ModelsHttpProviderModelsResponse>;
