// GENERATED: pnpm api:generate

import type { AgentConfigApi } from "../agent-config.js";
import {
  AgentConfigGetResponse,
  AgentConfigListResponse,
  AgentConfigUpdateRequest,
  AgentConfigUpdateResponse,
} from "@tyrum/contracts";
import { HttpTransport, validateOrThrow } from "../shared.js";

export function createAgentConfigApi(transport: HttpTransport): AgentConfigApi {
  return {
    async list(options) {
      return await transport.request({
        method: "GET",
        path: "/config/agents",
        response: AgentConfigListResponse,
        signal: options?.signal,
      });
    },

    async get(agentKey, options) {
      return await transport.request({
        method: "GET",
        path: `/config/agents/${encodeURIComponent(agentKey)}`,
        response: AgentConfigGetResponse,
        signal: options?.signal,
      });
    },

    async update(agentKey, input, options) {
      const body = validateOrThrow(AgentConfigUpdateRequest, input, "agent config update request");
      return await transport.request({
        method: "PUT",
        path: `/config/agents/${encodeURIComponent(agentKey)}`,
        body,
        response: AgentConfigUpdateResponse,
        signal: options?.signal,
      });
    },
  };
}
