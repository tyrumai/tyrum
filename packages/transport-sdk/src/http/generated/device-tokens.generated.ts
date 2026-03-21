// GENERATED: pnpm api:generate

import type { DeviceTokensApi } from "../device-tokens.js";
import {
  DeviceTokenIssueRequest,
  DeviceTokenIssueResponse,
  DeviceTokenRevokeRequest,
  DeviceTokenRevokeResponse,
} from "@tyrum/contracts";
import { HttpTransport, validateOrThrow } from "../shared.js";

export function createDeviceTokensApi(transport: HttpTransport): DeviceTokensApi {
  return {
    async issue(input, options) {
      const body = validateOrThrow(DeviceTokenIssueRequest, input, "device token issue request");
      return await transport.request({
        method: "POST",
        path: "/auth/device-tokens/issue",
        body,
        response: DeviceTokenIssueResponse,
        expectedStatus: 201,
        signal: options?.signal,
      });
    },

    async revoke(input, options) {
      const body = validateOrThrow(DeviceTokenRevokeRequest, input, "device token revoke request");
      return await transport.request({
        method: "POST",
        path: "/auth/device-tokens/revoke",
        body,
        response: DeviceTokenRevokeResponse,
        signal: options?.signal,
      });
    },
  };
}
