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
import type { z } from "zod";
import { HttpTransport, type TyrumRequestOptions, validateOrThrow } from "./shared.js";

export type ManagedAgentListResult = z.output<typeof ManagedAgentListResponse>;
export type ManagedAgentGetResult = z.output<typeof ManagedAgentGetResponse>;
export type AgentCapabilitiesResult = z.output<typeof AgentCapabilitiesResponse>;
export type ManagedAgentCreateInput = z.input<typeof ManagedAgentCreateRequest>;
export type ManagedAgentUpdateInput = z.input<typeof ManagedAgentUpdateRequest>;
export type ManagedAgentRenameInput = z.input<typeof ManagedAgentRenameRequest>;
export type ManagedAgentDeleteResult = z.output<typeof ManagedAgentDeleteResponse>;
export type ManagedAgentRenameResult = z.output<typeof ManagedAgentRenameResponse>;

export interface AgentsApi {
  list(options?: TyrumRequestOptions): Promise<ManagedAgentListResult>;
  get(agentKey: string, options?: TyrumRequestOptions): Promise<ManagedAgentGetResult>;
  capabilities(agentKey: string, options?: TyrumRequestOptions): Promise<AgentCapabilitiesResult>;
  create(
    input: ManagedAgentCreateInput,
    options?: TyrumRequestOptions,
  ): Promise<ManagedAgentGetResult>;
  update(
    agentKey: string,
    input: ManagedAgentUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<ManagedAgentGetResult>;
  rename(
    agentKey: string,
    input: ManagedAgentRenameInput,
    options?: TyrumRequestOptions,
  ): Promise<ManagedAgentRenameResult>;
  delete(agentKey: string, options?: TyrumRequestOptions): Promise<ManagedAgentDeleteResult>;
}

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
