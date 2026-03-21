// GENERATED: pnpm api:generate

import type { SecretsApi } from "../secrets.js";
import {
  AgentKey,
  SecretHandle,
  SecretListResponse,
  SecretRevokeResponse,
  SecretRotateRequest,
  SecretRotateResponse,
  SecretStoreRequest,
} from "@tyrum/contracts";
import { HttpTransport, validateOrThrow } from "../shared.js";
import { z } from "zod";

const SecretStoreResponse = z
  .object({
    handle: SecretHandle,
  })
  .strict();
const SecretListQuery = z
  .object({
    agent_key: AgentKey.optional(),
  })
  .strict();
const SecretPathId = z.string().trim().min(1);
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
