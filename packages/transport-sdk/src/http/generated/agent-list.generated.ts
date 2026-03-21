// GENERATED: pnpm api:generate

import type { AgentListApi } from "../agent-list.js";
import { AgentListResponse } from "@tyrum/contracts";
import { HttpTransport, validateOrThrow } from "../shared.js";
import { z } from "zod";

const AgentListQuery = z
  .object({
    include_default: z.boolean().optional(),
  })
  .strict();
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
