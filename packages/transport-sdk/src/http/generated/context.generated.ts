// GENERATED: pnpm api:generate

import type { ContextApi } from "../context.js";
import {
  AgentId,
  AgentKey,
  ContextReport,
  DateTimeSchema,
  TurnId,
  UuidSchema,
  WorkspaceId,
} from "@tyrum/contracts";
import { HttpTransport, NonEmptyString, validateOrThrow } from "../shared.js";
import { z } from "zod";

const ContextGetQuery = z
  .object({
    agent_key: AgentKey.optional(),
  })
  .strict();
const ContextListQuery = z
  .object({
    conversation_id: NonEmptyString.optional(),
    turn_id: TurnId.optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();
const ContextReportRow = z
  .object({
    context_report_id: UuidSchema,
    conversation_id: NonEmptyString,
    channel: NonEmptyString,
    thread_id: NonEmptyString,
    agent_id: AgentId,
    workspace_id: WorkspaceId,
    turn_id: TurnId.nullable(),
    report: z.unknown().nullable(),
    created_at: DateTimeSchema,
  })
  .strict();
const ContextGetResponse = z
  .object({
    status: z.literal("ok"),
    report: ContextReport.nullable(),
  })
  .strict();
const ContextListResponse = z
  .object({
    status: z.literal("ok"),
    reports: z.array(ContextReportRow),
  })
  .strict();
const ContextDetailResponse = z
  .object({
    status: z.literal("ok"),
    report: ContextReportRow,
  })
  .strict();
const ToolRegistryQuery = z
  .object({
    agent_key: AgentKey.optional(),
  })
  .strict();
const ToolRegistryEntry = z
  .object({
    id: NonEmptyString,
    description: z.string(),
    source: z.enum(["builtin", "builtin_mcp", "mcp", "plugin"]),
    family: z.string().nullable(),
    backing_server_id: z.string().nullable(),
    enabled_by_agent: z.boolean(),
  })
  .strict();
const ToolRegistryResponse = z
  .object({
    status: z.literal("ok"),
    allowlist: z.array(z.string()),
    mcp_servers: z.array(z.string()),
    tools: z.array(ToolRegistryEntry),
  })
  .strict();
export function createContextApi(transport: HttpTransport): ContextApi {
  return {
    async get(query, options) {
      const parsedQuery = validateOrThrow(ContextGetQuery, query ?? {}, "context get query");
      return await transport.request({
        method: "GET",
        path: "/context",
        query: parsedQuery,
        response: ContextGetResponse,
        signal: options?.signal,
      });
    },

    async list(query, options) {
      const parsedQuery = validateOrThrow(ContextListQuery, query ?? {}, "context list query");
      return await transport.request({
        method: "GET",
        path: "/context/list",
        query: parsedQuery,
        response: ContextListResponse,
        signal: options?.signal,
      });
    },

    async detail(id, options) {
      const parsedId = validateOrThrow(UuidSchema, id, "context report id");
      return await transport.request({
        method: "GET",
        path: `/context/detail/${encodeURIComponent(parsedId)}`,
        response: ContextDetailResponse,
        signal: options?.signal,
      });
    },

    async tools(query, options) {
      const parsedQuery = validateOrThrow(ToolRegistryQuery, query ?? {}, "context tools query");
      return await transport.request({
        method: "GET",
        path: "/context/tools",
        query: parsedQuery,
        response: ToolRegistryResponse,
        signal: options?.signal,
      });
    },
  };
}
