// GENERATED: pnpm api:generate

import type { PluginsApi } from "../plugins.js";
import { HttpTransport, validateOrThrow } from "../shared.js";
import { PluginManifest } from "@tyrum/contracts";
import { z } from "zod";

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
