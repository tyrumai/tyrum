import {
  AuthTokenIssueResponse,
  AuthTokenListResponse,
  AuthTokenRevokeRequest,
  AuthTokenRevokeResponse,
  AuthTokenUpdateRequest,
  AuthTokenUpdateResponse,
  TenantAuthTokenIssueRequest,
} from "@tyrum/contracts";
import { z } from "zod";
import { HttpTransport, validateOrThrow, type TyrumRequestOptions } from "./shared.js";

export type AuthTokenListEntry = z.output<typeof AuthTokenListResponse>["tokens"][number];
export type AuthTokenListResult = z.output<typeof AuthTokenListResponse>;
export type AuthTokenIssueInput = z.input<typeof TenantAuthTokenIssueRequest>;
export type AuthTokenIssueResult = z.output<typeof AuthTokenIssueResponse>;
export type AuthTokenRevokeInput = z.input<typeof AuthTokenRevokeRequest>;
export type AuthTokenRevokeResult = z.output<typeof AuthTokenRevokeResponse>;
export type AuthTokenUpdateInput = z.input<typeof AuthTokenUpdateRequest>;
export type AuthTokenUpdateResult = z.output<typeof AuthTokenUpdateResponse>;

export interface AuthTokensApi {
  list(options?: TyrumRequestOptions): Promise<AuthTokenListResult>;
  issue(input: AuthTokenIssueInput, options?: TyrumRequestOptions): Promise<AuthTokenIssueResult>;
  update(
    tokenId: string,
    input: AuthTokenUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<AuthTokenUpdateResult>;
  revoke(
    input: AuthTokenRevokeInput,
    options?: TyrumRequestOptions,
  ): Promise<AuthTokenRevokeResult>;
}

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
