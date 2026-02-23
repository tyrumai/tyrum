import { z } from "zod";

export const PluginId = z.string().trim().min(1);
export type PluginId = z.infer<typeof PluginId>;

export const PluginContributions = z
  .object({
    tools: z.array(z.string().trim().min(1)).default([]),
    commands: z.array(z.string().trim().min(1)).default([]),
    routes: z.array(z.string().trim().min(1)).default([]),
    mcp_servers: z.array(z.string().trim().min(1)).default([]),
  })
  .strict()
  .default({ tools: [], commands: [], routes: [], mcp_servers: [] });
export type PluginContributions = z.infer<typeof PluginContributions>;

export const PluginPermissions = z
  .object({
    tools: z.array(z.string().trim().min(1)).default([]),
    network_egress: z.array(z.string().trim().min(1)).default([]),
    secrets: z.array(z.string().trim().min(1)).default([]),
    db: z.boolean().default(false),
  })
  .strict()
  .default({ tools: [], network_egress: [], secrets: [], db: false });
export type PluginPermissions = z.infer<typeof PluginPermissions>;

export const PluginManifest = z
  .object({
    id: PluginId,
    name: z.string().trim().min(1),
    version: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
    /** Relative path to an ESM entry module (external plugins). */
    entry: z.string().trim().min(1).optional(),
    contributes: PluginContributions.optional(),
    permissions: PluginPermissions.optional(),
    config_schema: z.record(z.string(), z.unknown()),
  })
  .strict();
export type PluginManifest = z.infer<typeof PluginManifest>;
