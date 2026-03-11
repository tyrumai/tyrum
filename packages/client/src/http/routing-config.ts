import {
  ObservedTelegramThreadListResponse,
  RoutingConfigGetResponse,
  RoutingConfigRevisionListResponse,
  RoutingConfigRevertRequest,
  RoutingConfigRevertResponse,
  TelegramConnectionConfigResponse,
  TelegramConnectionConfigUpdateRequest,
  RoutingConfigUpdateRequest,
  RoutingConfigUpdateResponse,
} from "@tyrum/schemas";
import { z } from "zod";
import { HttpTransport, validateOrThrow, type TyrumRequestOptions } from "./shared.js";

const RoutingConfigListQuery = z
  .object({
    limit: z.number().int().positive().optional(),
  })
  .strict();

export type RoutingConfigGetResult = z.output<typeof RoutingConfigGetResponse>;
export type RoutingConfigUpdateInput = z.input<typeof RoutingConfigUpdateRequest>;
export type RoutingConfigUpdateResult = z.output<typeof RoutingConfigUpdateResponse>;
export type RoutingConfigRevertInput = z.input<typeof RoutingConfigRevertRequest>;
export type RoutingConfigRevertResult = z.output<typeof RoutingConfigRevertResponse>;
export type RoutingConfigRevisionListResult = z.output<typeof RoutingConfigRevisionListResponse>;
export type ObservedTelegramThreadListResult = z.output<typeof ObservedTelegramThreadListResponse>;
export type TelegramConnectionConfigResult = z.output<typeof TelegramConnectionConfigResponse>;
export type TelegramConnectionConfigUpdateInput = z.input<
  typeof TelegramConnectionConfigUpdateRequest
>;
export type RoutingConfigListQuery = z.input<typeof RoutingConfigListQuery>;

export interface RoutingConfigApi {
  get(options?: TyrumRequestOptions): Promise<RoutingConfigGetResult>;
  listRevisions(
    query?: RoutingConfigListQuery,
    options?: TyrumRequestOptions,
  ): Promise<RoutingConfigRevisionListResult>;
  listObservedTelegramThreads(
    query?: RoutingConfigListQuery,
    options?: TyrumRequestOptions,
  ): Promise<ObservedTelegramThreadListResult>;
  getTelegramConfig(options?: TyrumRequestOptions): Promise<TelegramConnectionConfigResult>;
  update(
    input: RoutingConfigUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<RoutingConfigUpdateResult>;
  updateTelegramConfig(
    input: TelegramConnectionConfigUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<TelegramConnectionConfigResult>;
  revert(
    input: RoutingConfigRevertInput,
    options?: TyrumRequestOptions,
  ): Promise<RoutingConfigRevertResult>;
}

export function createRoutingConfigApi(transport: HttpTransport): RoutingConfigApi {
  return {
    async get(options) {
      return await transport.request({
        method: "GET",
        path: "/routing/config",
        response: RoutingConfigGetResponse,
        signal: options?.signal,
      });
    },

    async listRevisions(query, options) {
      const parsedQuery = validateOrThrow(
        RoutingConfigListQuery,
        query ?? {},
        "routing config revisions query",
      );
      return await transport.request({
        method: "GET",
        path: "/routing/config/revisions",
        query: parsedQuery,
        response: RoutingConfigRevisionListResponse,
        signal: options?.signal,
      });
    },

    async listObservedTelegramThreads(query, options) {
      const parsedQuery = validateOrThrow(
        RoutingConfigListQuery,
        query ?? {},
        "routing observed telegram threads query",
      );
      return await transport.request({
        method: "GET",
        path: "/routing/channels/telegram/threads",
        query: parsedQuery,
        response: ObservedTelegramThreadListResponse,
        signal: options?.signal,
      });
    },

    async getTelegramConfig(options) {
      return await transport.request({
        method: "GET",
        path: "/routing/channels/telegram/config",
        response: TelegramConnectionConfigResponse,
        signal: options?.signal,
      });
    },

    async update(input, options) {
      const body = validateOrThrow(
        RoutingConfigUpdateRequest,
        input,
        "routing config update request",
      );
      return await transport.request({
        method: "PUT",
        path: "/routing/config",
        body,
        response: RoutingConfigUpdateResponse,
        expectedStatus: 201,
        signal: options?.signal,
      });
    },

    async updateTelegramConfig(input, options) {
      const body = validateOrThrow(
        TelegramConnectionConfigUpdateRequest,
        input,
        "telegram connection config update request",
      );
      return await transport.request({
        method: "PUT",
        path: "/routing/channels/telegram/config",
        body,
        response: TelegramConnectionConfigResponse,
        expectedStatus: 200,
        signal: options?.signal,
      });
    },

    async revert(input, options) {
      const body = validateOrThrow(
        RoutingConfigRevertRequest,
        input,
        "routing config revert request",
      );
      return await transport.request({
        method: "POST",
        path: "/routing/config/revert",
        body,
        response: RoutingConfigRevertResponse,
        expectedStatus: 201,
        signal: options?.signal,
      });
    },
  };
}
