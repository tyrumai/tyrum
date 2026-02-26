import {
  RoutingConfigGetResponse,
  RoutingConfigRevertRequest,
  RoutingConfigRevertResponse,
  RoutingConfigUpdateRequest,
  RoutingConfigUpdateResponse,
} from "@tyrum/schemas";
import { HttpTransport, validateOrThrow, type TyrumRequestOptions } from "./shared.js";
import { z } from "zod";

export type RoutingConfigGetResult = z.output<typeof RoutingConfigGetResponse>;
export type RoutingConfigUpdateInput = z.input<typeof RoutingConfigUpdateRequest>;
export type RoutingConfigUpdateResult = z.output<typeof RoutingConfigUpdateResponse>;
export type RoutingConfigRevertInput = z.input<typeof RoutingConfigRevertRequest>;
export type RoutingConfigRevertResult = z.output<typeof RoutingConfigRevertResponse>;

export interface RoutingConfigApi {
  get(options?: TyrumRequestOptions): Promise<RoutingConfigGetResult>;
  update(
    input: RoutingConfigUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<RoutingConfigUpdateResult>;
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

