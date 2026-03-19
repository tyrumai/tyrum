import { z } from "zod";

export const ModelsDevModel = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    family: z.string().trim().min(1).optional(),
    attachment: z.boolean().optional(),
    reasoning: z.boolean().optional(),
    tool_call: z.boolean().optional(),
    structured_output: z.boolean().optional(),
    temperature: z.boolean().optional(),
    knowledge: z.string().trim().min(1).optional(),
    release_date: z.string().trim().min(1).optional(),
    last_updated: z.string().trim().min(1).optional(),
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])).optional(),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])).optional(),
      })
      .optional(),
    open_weights: z.boolean().optional(),
    cost: z.unknown().optional(),
    limit: z.record(z.string(), z.number()).optional(),
  })
  .passthrough();
export type ModelsDevModel = z.infer<typeof ModelsDevModel>;

export const ModelsDevProvider = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    env: z.array(z.string().trim().min(1)).default([]),
    npm: z.string().trim().min(1).optional(),
    api: z.string().trim().min(1).optional(),
    doc: z.string().trim().min(1).optional(),
    models: z.record(z.string(), ModelsDevModel).default({}),
  })
  .passthrough();
export type ModelsDevProvider = z.infer<typeof ModelsDevProvider>;

export const ModelsDevCatalog = z.record(z.string(), ModelsDevProvider);
export type ModelsDevCatalog = z.infer<typeof ModelsDevCatalog>;
