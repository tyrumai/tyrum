import {
  AgentId,
  AgentKey,
  ContextReport,
  DateTimeSchema,
  ExecutionRunId,
  UuidSchema,
  WorkspaceId,
} from "@tyrum/schemas";
import { z } from "zod";
import {
  HttpTransport,
  NonEmptyString,
  validateOrThrow,
  type TyrumRequestOptions,
} from "./shared.js";

const ContextGetQuery = z
  .object({
    agent_key: AgentKey.optional(),
  })
  .strict();

const ContextListQuery = z
  .object({
    session_id: NonEmptyString.optional(),
    run_id: ExecutionRunId.optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

const ContextReportRow = z
  .object({
    context_report_id: UuidSchema,
    session_id: NonEmptyString,
    channel: NonEmptyString,
    thread_id: NonEmptyString,
    agent_id: AgentId,
    workspace_id: WorkspaceId,
    run_id: ExecutionRunId.nullable(),
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

export type ContextGetResponse = z.infer<typeof ContextGetResponse>;
export type ContextListResponse = z.infer<typeof ContextListResponse>;
export type ContextDetailResponse = z.infer<typeof ContextDetailResponse>;
export type ToolRegistryResponse = z.infer<typeof ToolRegistryResponse>;

export interface ContextApi {
  get(
    query?: z.input<typeof ContextGetQuery>,
    options?: TyrumRequestOptions,
  ): Promise<ContextGetResponse>;
  list(
    query?: z.input<typeof ContextListQuery>,
    options?: TyrumRequestOptions,
  ): Promise<ContextListResponse>;
  detail(id: string, options?: TyrumRequestOptions): Promise<ContextDetailResponse>;
  tools(
    query?: z.input<typeof ToolRegistryQuery>,
    options?: TyrumRequestOptions,
  ): Promise<ToolRegistryResponse>;
}

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
