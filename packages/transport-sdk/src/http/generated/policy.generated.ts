// GENERATED: pnpm api:generate

import type { PolicyApi } from "../policy.js";
import { HttpTransport, validateOrThrow } from "../shared.js";
import {
  PolicyBundle,
  PolicyOverrideCreateRequest,
  PolicyOverrideCreateResponse,
  PolicyOverrideListRequest,
  PolicyOverrideListResponse,
  PolicyOverrideRevokeRequest,
  PolicyOverrideRevokeResponse,
  DateTimeSchema,
} from "@tyrum/contracts";
import { z } from "zod";

const PolicyBundleResponse = z
  .object({
    status: z.literal("ok"),
    generated_at: DateTimeSchema,
    effective: z
      .object({
        sha256: z.string().trim().min(1),
        bundle: PolicyBundle,
        sources: z
          .object({
            deployment: z.string().trim().min(1),
            agent: z.string().trim().min(1).nullable(),
            playbook: z.union([z.literal("inline"), z.null()]),
          })
          .passthrough(),
      })
      .strict(),
  })
  .strict();
export function createPolicyApi(transport: HttpTransport): PolicyApi {
  return {
    async getBundle(options) {
      return await transport.request({
        method: "GET",
        path: "/policy/bundle",
        response: PolicyBundleResponse,
        signal: options?.signal,
      });
    },

    async listOverrides(query, options) {
      const parsedQuery = validateOrThrow(
        PolicyOverrideListRequest,
        query ?? {},
        "policy override list query",
      );

      return await transport.request({
        method: "GET",
        path: "/policy/overrides",
        query: parsedQuery,
        response: PolicyOverrideListResponse,
        signal: options?.signal,
      });
    },

    async createOverride(input, options) {
      const body = validateOrThrow(
        PolicyOverrideCreateRequest,
        input,
        "policy override create request",
      );
      return await transport.request({
        method: "POST",
        path: "/policy/overrides",
        body,
        response: PolicyOverrideCreateResponse,
        expectedStatus: 201,
        signal: options?.signal,
      });
    },

    async revokeOverride(input, options) {
      const body = validateOrThrow(
        PolicyOverrideRevokeRequest,
        input,
        "policy override revoke request",
      );
      return await transport.request({
        method: "POST",
        path: "/policy/overrides/revoke",
        body,
        response: PolicyOverrideRevokeResponse,
        signal: options?.signal,
      });
    },
  };
}
