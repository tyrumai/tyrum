// GENERATED: pnpm api:generate

import type { AgentsApi } from "../agents.js";
import {
  AgentCapabilitiesResponse,
  ManagedAgentCreateRequest,
  ManagedAgentDeleteResponse,
  ManagedAgentGetResponse,
  ManagedAgentListResponse,
  ManagedAgentRenameRequest,
  ManagedAgentRenameResponse,
  ManagedAgentUpdateRequest,
} from "@tyrum/contracts";
import { HttpTransport, validateOrThrow } from "../shared.js";

export function createAgentsApi(transport: HttpTransport): AgentsApi {
  return {
    async list(options) {
      return await transport.request({
        method: "GET",
        path: "/agents",
        response: ManagedAgentListResponse,
        signal: options?.signal,
      });
    },

    async get(agentKey, options) {
      return await transport.request({
        method: "GET",
        path: `/agents/${encodeURIComponent(agentKey)}`,
        response: ManagedAgentGetResponse,
        signal: options?.signal,
      });
    },

    async capabilities(agentKey, options) {
      return await transport.request({
        method: "GET",
        path: `/agents/${encodeURIComponent(agentKey)}/capabilities`,
        response: AgentCapabilitiesResponse,
        signal: options?.signal,
      });
    },

    async create(input, options) {
      const body = validateOrThrow(ManagedAgentCreateRequest, input, "agent create request");
      return await transport.request({
        method: "POST",
        path: "/agents",
        body,
        response: ManagedAgentGetResponse,
        expectedStatus: 201,
        signal: options?.signal,
      });
    },

    async update(agentKey, input, options) {
      const body = validateOrThrow(ManagedAgentUpdateRequest, input, "agent update request");
      return await transport.request({
        method: "PUT",
        path: `/agents/${encodeURIComponent(agentKey)}`,
        body,
        response: ManagedAgentGetResponse,
        signal: options?.signal,
      });
    },

    async rename(agentKey, input, options) {
      const body = validateOrThrow(ManagedAgentRenameRequest, input, "agent rename request");
      return await transport.request({
        method: "POST",
        path: `/agents/${encodeURIComponent(agentKey)}/rename`,
        body,
        response: ManagedAgentRenameResponse,
        signal: options?.signal,
      });
    },

    async delete(agentKey, options) {
      return await transport.request({
        method: "DELETE",
        path: `/agents/${encodeURIComponent(agentKey)}`,
        response: ManagedAgentDeleteResponse,
        signal: options?.signal,
      });
    },
  };
}
