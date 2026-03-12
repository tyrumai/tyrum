import {
  ChannelConfigCreateRequest,
  ChannelConfigCreateResponse,
  ChannelConfigDeleteResponse,
  ChannelConfigListResponse,
  ChannelConfigUpdateResponse,
  ObservedTelegramThreadListResponse,
  RoutingConfigGetResponse,
  RoutingConfigRevisionListResponse,
  RoutingConfigRevertRequest,
  RoutingConfigRevertResponse,
  TelegramChannelConfigUpdateRequest,
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
export type ChannelConfigListResult = z.output<typeof ChannelConfigListResponse>;
export type ChannelConfigCreateInput = z.input<typeof ChannelConfigCreateRequest>;
export type ChannelConfigCreateResult = z.output<typeof ChannelConfigCreateResponse>;
export type TelegramChannelConfigUpdateInput = z.input<typeof TelegramChannelConfigUpdateRequest>;
export type ChannelConfigUpdateResult = z.output<typeof ChannelConfigUpdateResponse>;
export type ChannelConfigDeleteResult = z.output<typeof ChannelConfigDeleteResponse>;
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
  listChannelConfigs(options?: TyrumRequestOptions): Promise<ChannelConfigListResult>;
  createChannelConfig(
    input: ChannelConfigCreateInput,
    options?: TyrumRequestOptions,
  ): Promise<ChannelConfigCreateResult>;
  update(
    input: RoutingConfigUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<RoutingConfigUpdateResult>;
  updateChannelConfig(
    channel: "telegram",
    accountKey: string,
    input: TelegramChannelConfigUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<ChannelConfigUpdateResult>;
  deleteChannelConfig(
    channel: "telegram",
    accountKey: string,
    options?: TyrumRequestOptions,
  ): Promise<ChannelConfigDeleteResult>;
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

    async listChannelConfigs(options) {
      return await transport.request({
        method: "GET",
        path: "/routing/channels/configs",
        response: ChannelConfigListResponse,
        signal: options?.signal,
      });
    },

    async createChannelConfig(input, options) {
      const body = validateOrThrow(
        ChannelConfigCreateRequest,
        input,
        "channel config create request",
      );
      return await transport.request({
        method: "POST",
        path: "/routing/channels/configs",
        body,
        response: ChannelConfigCreateResponse,
        expectedStatus: 201,
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

    async updateChannelConfig(channel, accountKey, input, options) {
      const body = validateOrThrow(
        TelegramChannelConfigUpdateRequest,
        input,
        "telegram channel config update request",
      );
      return await transport.request({
        method: "PATCH",
        path: `/routing/channels/configs/${encodeURIComponent(channel)}/${encodeURIComponent(accountKey)}`,
        body,
        response: ChannelConfigUpdateResponse,
        expectedStatus: 200,
        signal: options?.signal,
      });
    },

    async deleteChannelConfig(channel, accountKey, options) {
      return await transport.request({
        method: "DELETE",
        path: `/routing/channels/configs/${encodeURIComponent(channel)}/${encodeURIComponent(accountKey)}`,
        response: ChannelConfigDeleteResponse,
        expectedStatus: [200, 404],
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
