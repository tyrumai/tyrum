// GENERATED: pnpm api:generate

import type { AuthTokensApi } from "../auth-tokens.js";
import {
  AuthTokenIssueResponse,
  AuthTokenListResponse,
  AuthTokenRevokeRequest,
  AuthTokenRevokeResponse,
  AuthTokenUpdateRequest,
  AuthTokenUpdateResponse,
  TenantAuthTokenIssueRequest,
} from "@tyrum/contracts";
import { HttpTransport, validateOrThrow } from "../shared.js";
import { z } from "zod";

export function createAuthTokensApi(transport: HttpTransport): AuthTokensApi {
  return {
    async list(options) {
      return await transport.request({
        method: "GET",
        path: "/auth/tokens",
        response: AuthTokenListResponse,
        signal: options?.signal,
      });
    },

    async issue(input, options) {
      const body = validateOrThrow(TenantAuthTokenIssueRequest, input, "auth token issue request");
      return await transport.request({
        method: "POST",
        path: "/auth/tokens/issue",
        body,
        response: AuthTokenIssueResponse,
        expectedStatus: 201,
        signal: options?.signal,
      });
    },

    async update(tokenId, input, options) {
      const body = validateOrThrow(AuthTokenUpdateRequest, input, "auth token update request");
      const parsedTokenId = z.string().trim().min(1).parse(tokenId);
      return await transport.request({
        method: "PATCH",
        path: `/auth/tokens/${encodeURIComponent(parsedTokenId)}`,
        body,
        response: AuthTokenUpdateResponse,
        signal: options?.signal,
      });
    },

    async revoke(input, options) {
      const body = validateOrThrow(AuthTokenRevokeRequest, input, "auth token revoke request");
      return await transport.request({
        method: "POST",
        path: "/auth/tokens/revoke",
        body,
        response: AuthTokenRevokeResponse,
        signal: options?.signal,
      });
    },
  };
}
