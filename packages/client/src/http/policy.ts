import {
  PolicyBundle,
  PolicyOverrideCreateRequest,
  PolicyOverrideCreateResponse,
  PolicyOverrideListRequest,
  PolicyOverrideListResponse,
  PolicyOverrideRevokeRequest,
  PolicyOverrideRevokeResponse,
  DateTimeSchema,
} from "@tyrum/schemas";
import { z } from "zod";
import { HttpTransport, validateOrThrow } from "./shared.js";

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

export type PolicyBundleResponse = z.infer<typeof PolicyBundleResponse>;
export type PolicyOverrideListInput = z.input<typeof PolicyOverrideListRequest>;
export type PolicyOverrideListResult = z.output<typeof PolicyOverrideListResponse>;
export type PolicyOverrideCreateInput = z.input<typeof PolicyOverrideCreateRequest>;
export type PolicyOverrideCreateResult = z.output<typeof PolicyOverrideCreateResponse>;
export type PolicyOverrideRevokeInput = z.input<typeof PolicyOverrideRevokeRequest>;
export type PolicyOverrideRevokeResult = z.output<typeof PolicyOverrideRevokeResponse>;

export interface PolicyApi {
  getBundle(): Promise<PolicyBundleResponse>;
  listOverrides(query?: PolicyOverrideListInput): Promise<PolicyOverrideListResult>;
  createOverride(input: PolicyOverrideCreateInput): Promise<PolicyOverrideCreateResult>;
  revokeOverride(input: PolicyOverrideRevokeInput): Promise<PolicyOverrideRevokeResult>;
}

export function createPolicyApi(transport: HttpTransport): PolicyApi {
  return {
    async getBundle() {
      return await transport.request({
        method: "GET",
        path: "/policy/bundle",
        response: PolicyBundleResponse,
      });
    },

    async listOverrides(query) {
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
      });
    },

    async createOverride(input) {
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
      });
    },

    async revokeOverride(input) {
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
      });
    },
  };
}
