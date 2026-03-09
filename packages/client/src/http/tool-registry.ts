import { z } from "zod";
import { HttpTransport, type TyrumRequestOptions } from "./shared.js";

const ToolRegistrySource = z.enum(["builtin", "builtin_mcp", "mcp", "plugin"]);
const ToolRisk = z.enum(["low", "medium", "high"]);

const ToolRegistryBackingServer = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    transport: z.string().trim().min(1),
    url: z.string().url().optional(),
  })
  .strict();

const ToolRegistryPlugin = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    version: z.string().trim().min(1),
  })
  .strict();

const ToolRegistryEntry = z
  .object({
    source: ToolRegistrySource,
    canonical_id: z.string().trim().min(1),
    description: z.string(),
    risk: ToolRisk,
    requires_confirmation: z.boolean(),
    effective_exposure: z
      .object({
        enabled: z.boolean(),
        reason: z.enum(["enabled", "disabled_by_agent_allowlist", "disabled_by_state_mode"]),
        agent_key: z.string().trim().min(1).optional(),
      })
      .strict(),
    family: z.string().trim().min(1).optional(),
    keywords: z.array(z.string().trim().min(1)).optional(),
    input_schema: z.record(z.string(), z.unknown()).optional(),
    backing_server: ToolRegistryBackingServer.optional(),
    plugin: ToolRegistryPlugin.optional(),
  })
  .strict();

const ToolRegistryListResponse = z
  .object({
    status: z.literal("ok"),
    tools: z.array(ToolRegistryEntry),
  })
  .strict();

export type ToolRegistryListResult = z.output<typeof ToolRegistryListResponse>;

export interface ToolRegistryListOptions extends TyrumRequestOptions {
  agentKey?: string;
}

export interface ToolRegistryApi {
  list(options?: ToolRegistryListOptions): Promise<ToolRegistryListResult>;
}

export function createToolRegistryApi(transport: HttpTransport): ToolRegistryApi {
  return {
    async list(options) {
      return await transport.request({
        method: "GET",
        path: "/config/tools",
        query: options?.agentKey ? { agent_key: options.agentKey } : undefined,
        response: ToolRegistryListResponse,
        signal: options?.signal,
      });
    },
  };
}
