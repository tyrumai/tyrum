import { PluginManifest, type PluginManifest as PluginManifestT } from "@tyrum/contracts";
import { z } from "zod";
import { HttpTransport, validateOrThrow, type TyrumRequestOptions } from "./shared.js";

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
  list(options?: TyrumRequestOptions): Promise<PluginListResponse>;
  get(pluginId: string, options?: TyrumRequestOptions): Promise<PluginGetResponse>;
}

export function createPluginsApi(transport: HttpTransport): PluginsApi {
  return {
    async list(options) {
      return await transport.request({
        method: "GET",
        path: "/plugins",
        response: PluginListResponse,
        signal: options?.signal,
      });
    },

    async get(pluginId, options) {
      const parsedPluginId = validateOrThrow(PluginIdPath, pluginId, "plugin id");
      return await transport.request({
        method: "GET",
        path: `/plugins/${encodeURIComponent(parsedPluginId)}`,
        response: PluginGetResponse,
        signal: options?.signal,
      });
    },
  };
}

export type { PluginManifestT };
