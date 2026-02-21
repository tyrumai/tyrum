import { z } from "zod";

export const PluginToolRisk = z.enum(["low", "medium", "high"]);
export type PluginToolRisk = z.infer<typeof PluginToolRisk>;

export const PluginToolDescriptor = z
  .object({
    id: z.string().trim().min(1),
    description: z.string().trim().min(1),
    risk: PluginToolRisk,
    requires_confirmation: z.boolean().default(false),
    keywords: z.array(z.string()).default([]),
    input_schema: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type PluginToolDescriptor = z.infer<typeof PluginToolDescriptor>;

export const PluginPermission = z.enum(["tools"]);
export type PluginPermission = z.infer<typeof PluginPermission>;

export const PluginManifest = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    version: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    entrypoint: z.string().trim().min(1).default("./index.mjs"),
    permissions: z.array(PluginPermission).default([]),
    tools: z.array(PluginToolDescriptor).default([]),
  })
  .strict();
export type PluginManifest = z.infer<typeof PluginManifest>;

