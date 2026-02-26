import { AgentId, AgentStatusResponse } from "@tyrum/schemas";
import { z } from "zod";
import { HttpTransport, validateOrThrow, type TyrumRequestOptions } from "./shared.js";

const AgentStatusQuery = z
  .object({
    agent_id: AgentId.optional(),
  })
  .strict();

export type AgentStatusResult = z.output<typeof AgentStatusResponse>;

export interface AgentStatusApi {
  get(
    query?: z.input<typeof AgentStatusQuery>,
    options?: TyrumRequestOptions,
  ): Promise<AgentStatusResult>;
}

export function createAgentStatusApi(transport: HttpTransport): AgentStatusApi {
  return {
    async get(query, options) {
      const parsedQuery = validateOrThrow(AgentStatusQuery, query ?? {}, "agent status query");
      return await transport.request({
        method: "GET",
        path: "/agent/status",
        query: parsedQuery,
        response: AgentStatusResponse,
        signal: options?.signal,
      });
    },
  };
}

