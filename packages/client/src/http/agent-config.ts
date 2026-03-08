import {
  AgentConfigGetResponse,
  AgentConfigListResponse,
  AgentConfigUpdateRequest,
  AgentConfigUpdateResponse,
} from "@tyrum/schemas";
import type { z } from "zod";
import { HttpTransport, validateOrThrow, type TyrumRequestOptions } from "./shared.js";

export type AgentConfigListResult = z.output<typeof AgentConfigListResponse>;
export type AgentConfigGetResult = z.output<typeof AgentConfigGetResponse>;
export type AgentConfigUpdateInput = z.input<typeof AgentConfigUpdateRequest>;
export type AgentConfigUpdateResult = z.output<typeof AgentConfigUpdateResponse>;

export interface AgentConfigApi {
  list(options?: TyrumRequestOptions): Promise<AgentConfigListResult>;
  get(agentKey: string, options?: TyrumRequestOptions): Promise<AgentConfigGetResult>;
  update(
    agentKey: string,
    input: AgentConfigUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<AgentConfigUpdateResult>;
}

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
