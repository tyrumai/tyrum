import {
  ChannelAccountCreateRequest,
  ChannelAccountDeleteResponse,
  ChannelAccountMutateResponse,
  ChannelAccountUpdateRequest,
  ChannelRegistryResponse,
  ConfiguredChannelListResponse,
} from "@tyrum/schemas";
import { z } from "zod";
import {
  HttpTransport,
  NonEmptyString,
  type TyrumRequestOptions,
  validateOrThrow,
} from "./shared.js";

const ChannelPathKey = NonEmptyString;

export type ChannelRegistryResult = z.output<typeof ChannelRegistryResponse>;
export type ConfiguredChannelListResult = z.output<typeof ConfiguredChannelListResponse>;
export type ChannelAccountCreateInput = z.input<typeof ChannelAccountCreateRequest>;
export type ChannelAccountUpdateInput = z.input<typeof ChannelAccountUpdateRequest>;
export type ChannelAccountMutateResult = z.output<typeof ChannelAccountMutateResponse>;
export type ChannelAccountDeleteResult = z.output<typeof ChannelAccountDeleteResponse>;

export interface ChannelConfigApi {
  listRegistry(options?: TyrumRequestOptions): Promise<ChannelRegistryResult>;
  listChannels(options?: TyrumRequestOptions): Promise<ConfiguredChannelListResult>;
  createAccount(
    input: ChannelAccountCreateInput,
    options?: TyrumRequestOptions,
  ): Promise<ChannelAccountMutateResult>;
  updateAccount(
    channel: string,
    accountKey: string,
    input: ChannelAccountUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<ChannelAccountMutateResult>;
  deleteAccount(
    channel: string,
    accountKey: string,
    options?: TyrumRequestOptions,
  ): Promise<ChannelAccountDeleteResult>;
}

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
