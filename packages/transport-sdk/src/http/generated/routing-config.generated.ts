// GENERATED: pnpm api:generate

import type { RoutingConfigApi } from "../routing-config.js";
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
} from "@tyrum/contracts";
import { HttpTransport, validateOrThrow } from "../shared.js";
import { z } from "zod";

const RoutingConfigListQuery = z
  .object({
    limit: z.number().int().positive().optional(),
  })
  .strict();
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
