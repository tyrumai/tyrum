import {
  DeviceTokenIssueRequest,
  DeviceTokenIssueResponse,
  DeviceTokenRevokeRequest,
  DeviceTokenRevokeResponse,
} from "@tyrum/schemas";
import { z } from "zod";
import { HttpTransport, validateOrThrow } from "./shared.js";

export type DeviceTokenIssueInput = z.input<typeof DeviceTokenIssueRequest>;
export type DeviceTokenIssueResult = z.output<typeof DeviceTokenIssueResponse>;
export type DeviceTokenRevokeInput = z.input<typeof DeviceTokenRevokeRequest>;
export type DeviceTokenRevokeResult = z.output<typeof DeviceTokenRevokeResponse>;

export interface DeviceTokensApi {
  issue(input: DeviceTokenIssueInput): Promise<DeviceTokenIssueResult>;
  revoke(input: DeviceTokenRevokeInput): Promise<DeviceTokenRevokeResult>;
}

export function createDeviceTokensApi(transport: HttpTransport): DeviceTokensApi {
  return {
    async issue(input) {
      const body = validateOrThrow(DeviceTokenIssueRequest, input, "device token issue request");
      return await transport.request({
        method: "POST",
        path: "/auth/device-tokens/issue",
        body,
        response: DeviceTokenIssueResponse,
        expectedStatus: 201,
      });
    },

    async revoke(input) {
      const body = validateOrThrow(DeviceTokenRevokeRequest, input, "device token revoke request");
      return await transport.request({
        method: "POST",
        path: "/auth/device-tokens/revoke",
        body,
        response: DeviceTokenRevokeResponse,
      });
    },
  };
}
