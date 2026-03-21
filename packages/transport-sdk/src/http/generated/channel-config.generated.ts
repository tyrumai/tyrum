// GENERATED: pnpm api:generate

import type { ChannelConfigApi } from "../channel-config.js";
import {
  ChannelAccountCreateRequest,
  ChannelAccountDeleteResponse,
  ChannelAccountMutateResponse,
  ChannelAccountUpdateRequest,
  ChannelRegistryResponse,
  ConfiguredChannelListResponse,
} from "@tyrum/contracts";
import { HttpTransport, NonEmptyString, validateOrThrow } from "../shared.js";

const ChannelPathKey = NonEmptyString;
export function createChannelConfigApi(transport: HttpTransport): ChannelConfigApi {
  return {
    async listRegistry(options) {
      return await transport.request({
        method: "GET",
        path: "/config/channels/registry",
        response: ChannelRegistryResponse,
        signal: options?.signal,
      });
    },

    async listChannels(options) {
      return await transport.request({
        method: "GET",
        path: "/config/channels",
        response: ConfiguredChannelListResponse,
        signal: options?.signal,
      });
    },

    async createAccount(input, options) {
      const body = validateOrThrow(
        ChannelAccountCreateRequest,
        input,
        "channel account create request",
      );
      return await transport.request({
        method: "POST",
        path: "/config/channels/accounts",
        body,
        response: ChannelAccountMutateResponse,
        expectedStatus: 201,
        signal: options?.signal,
      });
    },

    async updateAccount(channel, accountKey, input, options) {
      const parsedChannel = validateOrThrow(ChannelPathKey, channel, "channel key");
      const parsedAccountKey = validateOrThrow(ChannelPathKey, accountKey, "channel account key");
      const body = validateOrThrow(
        ChannelAccountUpdateRequest,
        input,
        "channel account update request",
      );
      return await transport.request({
        method: "PATCH",
        path: `/config/channels/accounts/${encodeURIComponent(parsedChannel)}/${encodeURIComponent(parsedAccountKey)}`,
        body,
        response: ChannelAccountMutateResponse,
        signal: options?.signal,
      });
    },

    async deleteAccount(channel, accountKey, options) {
      const parsedChannel = validateOrThrow(ChannelPathKey, channel, "channel key");
      const parsedAccountKey = validateOrThrow(ChannelPathKey, accountKey, "channel account key");
      return await transport.request({
        method: "DELETE",
        path: `/config/channels/accounts/${encodeURIComponent(parsedChannel)}/${encodeURIComponent(parsedAccountKey)}`,
        response: ChannelAccountDeleteResponse,
        signal: options?.signal,
      });
    },
  };
}
