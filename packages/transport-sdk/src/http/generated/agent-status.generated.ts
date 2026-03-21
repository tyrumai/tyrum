// GENERATED: pnpm api:generate

import type { AgentStatusApi } from "../agent-status.js";
import { AgentKey, AgentStatusResponse } from "@tyrum/contracts";
import { HttpTransport, validateOrThrow } from "../shared.js";
import { z } from "zod";

const AgentStatusQuery = z
  .object({
    agent_key: AgentKey.optional(),
  })
  .strict();
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
