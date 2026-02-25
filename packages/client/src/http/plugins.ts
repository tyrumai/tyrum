import { PluginManifest, type PluginManifest as PluginManifestT } from "@tyrum/schemas";
import { z } from "zod";
import { HttpTransport, validateOrThrow } from "./shared.js";

const PluginListResponse = z
  .object({
    status: z.literal("ok"),
    plugins: z.array(PluginManifest),
  })
  .strict();

const PluginGetResponse = z
  .object({
    status: z.literal("ok"),
    plugin: PluginManifest,
  })
  .strict();

const PluginIdPath = z.string().trim().min(1);

export type PluginListResponse = z.infer<typeof PluginListResponse>;
export type PluginGetResponse = z.infer<typeof PluginGetResponse>;

export interface PluginsApi {
  list(): Promise<PluginListResponse>;
  get(pluginId: string): Promise<PluginGetResponse>;
}

export function createPluginsApi(transport: HttpTransport): PluginsApi {
  return {
    async list() {
      return await transport.request({
        method: "GET",
        path: "/plugins",
        response: PluginListResponse,
      });
    },

    async get(pluginId) {
      const parsedPluginId = validateOrThrow(PluginIdPath, pluginId, "plugin id");
      return await transport.request({
        method: "GET",
        path: `/plugins/${encodeURIComponent(parsedPluginId)}`,
        response: PluginGetResponse,
      });
    },
  };
}

export type { PluginManifestT };
