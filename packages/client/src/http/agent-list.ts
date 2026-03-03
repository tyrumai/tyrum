import { AgentId } from "@tyrum/schemas";
import { z } from "zod";
import { HttpTransport, validateOrThrow, type TyrumRequestOptions } from "./shared.js";

const AgentListQuery = z
  .object({
    include_default: z.boolean().optional(),
  })
  .strict();

const AgentListAgent = z
  .object({
    agent_id: AgentId,
    home: z.string().trim().min(1).optional(),
    has_config: z.boolean().optional(),
  })
  .strict();

const AgentListResponse = z
  .object({
    agents: z.array(AgentListAgent),
  })
  .strict();

export type AgentListResult = z.output<typeof AgentListResponse>;

export interface AgentListApi {
  get(
    query?: z.input<typeof AgentListQuery>,
    options?: TyrumRequestOptions,
  ): Promise<AgentListResult>;
}

export function createAgentListApi(transport: HttpTransport): AgentListApi {
  return {
    async get(query, options) {
      const parsedQuery = validateOrThrow(AgentListQuery, query ?? {}, "agent list query");
      return await transport.request({
        method: "GET",
        path: "/agent/list",
        query: parsedQuery,
        response: AgentListResponse,
        signal: options?.signal,
      });
    },
  };
}
