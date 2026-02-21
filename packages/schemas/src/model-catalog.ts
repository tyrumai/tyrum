import { z } from "zod";

export const ModelLimits = z.object({
  context: z.number().int().min(0),
  input: z.number().int().min(0).optional(),
  output: z.number().int().min(0),
});
export type ModelLimits = z.infer<typeof ModelLimits>;

export const ModelCost = z.object({
  input: z.number().min(0),
  output: z.number().min(0),
  cache_read: z.number().min(0).optional(),
  cache_write: z.number().min(0).optional(),
});
export type ModelCost = z.infer<typeof ModelCost>;

export const CatalogModel = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  family: z.string().nullable().optional(),
  attachment: z.boolean().default(false),
  reasoning: z.boolean().default(false),
  tool_call: z.boolean().default(false),
  cost: ModelCost.optional(),
  limit: ModelLimits,
});
export type CatalogModel = z.infer<typeof CatalogModel>;

export const CatalogProvider = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  env: z.array(z.string()).default([]),
  api: z.string().nullable().optional(),
  npm: z.string().nullable().optional(),
  models: z.record(z.string(), CatalogModel),
});
export type CatalogProvider = z.infer<typeof CatalogProvider>;
