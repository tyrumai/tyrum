import { z } from "zod";

export const PluginCapability = z.enum(["tools", "commands", "hooks", "storage"]);
export type PluginCapability = z.infer<typeof PluginCapability>;

export const PluginPermission = z.enum(["fs.read", "fs.write", "net.fetch", "env.read"]);
export type PluginPermission = z.infer<typeof PluginPermission>;

export const PluginManifestSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  version: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  entry: z.string().trim().min(1),
  capabilities: z.array(PluginCapability).default([]),
  permissions: z.array(PluginPermission).default([]),
});
export type PluginManifestSchema = z.infer<typeof PluginManifestSchema>;
