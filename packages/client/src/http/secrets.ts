import {
  SecretHandle,
  SecretListResponse,
  SecretRevokeResponse,
  SecretRotateRequest,
  SecretRotateResponse,
  SecretStoreRequest,
} from "@tyrum/schemas";
import { z } from "zod";
import { HttpTransport, validateOrThrow, type TyrumRequestOptions } from "./shared.js";

const SecretStoreResponse = z
  .object({
    handle: SecretHandle,
  })
  .strict();

const SecretListQuery = z
  .object({
    agent_id: z.string().trim().min(1).optional(),
  })
  .strict();

const SecretPathId = z.string().trim().min(1);

export type SecretStoreResponse = z.infer<typeof SecretStoreResponse>;
export type SecretStoreInput = z.input<typeof SecretStoreRequest>;
export type SecretListResult = z.output<typeof SecretListResponse>;
export type SecretRevokeResult = z.output<typeof SecretRevokeResponse>;
export type SecretRotateInput = z.input<typeof SecretRotateRequest>;
export type SecretRotateResult = z.output<typeof SecretRotateResponse>;

export interface SecretsApi {
  store(
    input: SecretStoreInput,
    query?: { agent_id?: string },
    options?: TyrumRequestOptions,
  ): Promise<SecretStoreResponse>;
  list(query?: { agent_id?: string }, options?: TyrumRequestOptions): Promise<SecretListResult>;
  revoke(
    secretId: string,
    query?: { agent_id?: string },
    options?: TyrumRequestOptions,
  ): Promise<SecretRevokeResult>;
  rotate(
    secretId: string,
    input: SecretRotateInput,
    query?: { agent_id?: string },
    options?: TyrumRequestOptions,
  ): Promise<SecretRotateResult>;
}

export function createSecretsApi(transport: HttpTransport): SecretsApi {
  return {
    async store(input, query, options) {
      const body = validateOrThrow(SecretStoreRequest, input, "secret store request");
      const parsedQuery = validateOrThrow(SecretListQuery, query ?? {}, "secret store query");
      return await transport.request({
        method: "POST",
        path: "/secrets",
        query: parsedQuery,
        body,
        response: SecretStoreResponse,
        expectedStatus: 201,
        signal: options?.signal,
      });
    },

    async list(query, options) {
      const parsedQuery = validateOrThrow(SecretListQuery, query ?? {}, "secret list query");
      return await transport.request({
        method: "GET",
        path: "/secrets",
        query: parsedQuery,
        response: SecretListResponse,
        signal: options?.signal,
      });
    },

    async revoke(secretId, query, options) {
      const parsedSecretId = validateOrThrow(SecretPathId, secretId, "secret id");
      const parsedQuery = validateOrThrow(SecretListQuery, query ?? {}, "secret revoke query");
      return await transport.request({
        method: "DELETE",
        path: `/secrets/${encodeURIComponent(parsedSecretId)}`,
        query: parsedQuery,
        response: SecretRevokeResponse,
        signal: options?.signal,
      });
    },

    async rotate(secretId, input, query, options) {
      const parsedSecretId = validateOrThrow(SecretPathId, secretId, "secret id");
      const parsedBody = validateOrThrow(SecretRotateRequest, input, "secret rotate request");
      const parsedQuery = validateOrThrow(SecretListQuery, query ?? {}, "secret rotate query");
      return await transport.request({
        method: "POST",
        path: `/secrets/${encodeURIComponent(parsedSecretId)}/rotate`,
        query: parsedQuery,
        body: parsedBody,
        response: SecretRotateResponse,
        expectedStatus: 201,
        signal: options?.signal,
      });
    },
  };
}
