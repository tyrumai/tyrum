// GENERATED: pnpm api:generate

import type { ToolRegistryApi } from "../tool-registry.js";
import { AgentKey, ConfiguredExecutionProfileId } from "@tyrum/contracts";
import { HttpTransport, validateOrThrow } from "../shared.js";
import { z } from "zod";

const ToolRegistrySource = z.enum(["builtin", "builtin_mcp", "mcp", "plugin"]);
const ToolEffect = z.enum(["read_only", "state_changing"]);
const ToolRegistryLifecycle = z.enum(["canonical", "alias", "deprecated"]);
const ToolRegistryVisibility = z.enum(["public", "internal", "runtime_only"]);
const ToolRegistryGroup = z
  .enum(["core", "retrieval", "memory", "environment", "node", "orchestration", "extension"])
  .nullable();
const ToolRegistryTier = z.enum(["default", "advanced"]).nullable();
const ToolRegistryExecutionProfile = z.union([
  ConfiguredExecutionProfileId,
  z.enum(["executor", "explorer", "reviewer", "integrator"]),
]);
const ToolRegistryAlias = z
  .object({
    id: z.string().trim().min(1),
    lifecycle: z.enum(["alias", "deprecated"]),
  })
  .strict();
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
    lifecycle: ToolRegistryLifecycle,
    visibility: ToolRegistryVisibility,
    aliases: z.array(ToolRegistryAlias),
    description: z.string(),
    effect: ToolEffect,
    effective_exposure: z
      .object({
        enabled: z.boolean(),
        reason: z.enum([
          "enabled",
          "disabled_by_agent_allowlist",
          "disabled_by_agent_bundle",
          "disabled_by_agent_denylist",
          "disabled_by_agent_tier",
          "disabled_by_execution_profile",
          "disabled_by_plugin_opt_in",
          "disabled_by_plugin_policy",
          "disabled_by_state_mode",
          "disabled_invalid_schema",
        ]),
        agent_key: z.string().trim().min(1).optional(),
      })
      .strict(),
    family: z.string().trim().min(1).nullable(),
    group: ToolRegistryGroup,
    tier: ToolRegistryTier,
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
const ToolRegistryListQuery = z
  .object({
    agent_key: AgentKey.optional(),
    execution_profile: ToolRegistryExecutionProfile.optional(),
  })
  .strict();
export function createToolRegistryApi(transport: HttpTransport): ToolRegistryApi {
  return {
    async list(query, options) {
      const parsedQuery = validateOrThrow(
        ToolRegistryListQuery,
        query ?? {},
        "tool registry list query",
      );
      return await transport.request({
        method: "GET",
        path: "/config/tools",
        query: parsedQuery,
        response: ToolRegistryListResponse,
        signal: options?.signal,
      });
    },
  };
}
