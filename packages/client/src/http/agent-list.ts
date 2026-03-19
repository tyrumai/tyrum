import { AgentListResponse } from "@tyrum/contracts";
import { z } from "zod";
import { HttpTransport, validateOrThrow, type TyrumRequestOptions } from "./shared.js";

const AgentListQuery = z
  .object({
    include_default: z.boolean().optional(),
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
