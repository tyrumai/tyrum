// GENERATED: pnpm api:generate

import type { AuditApi } from "../audit.js";
import {
  AuditPlansListResponse,
  AuditForgetRequest,
  AuditForgetResponse,
  ChainVerification,
  DateTimeSchema,
  ReceiptBundle,
  Sha256Hex,
} from "@tyrum/contracts";
import { HttpTransport, NonEmptyString, validateOrThrow } from "../shared.js";
import { z } from "zod";

const ChainableEvent = z
  .object({
    id: z.number().int().nonnegative(),
    plan_id: NonEmptyString,
    step_index: z.number().int().nonnegative(),
    occurred_at: DateTimeSchema,
    action: NonEmptyString,
    prev_hash: Sha256Hex.nullable(),
    event_hash: Sha256Hex.nullable(),
  })
  .strict();
const AuditVerifyRequest = z
  .object({
    events: z.array(ChainableEvent),
  })
  .strict();
const AuditPlansListQuery = z
  .object({
    limit: z.number().int().positive().max(100).optional(),
  })
  .strict();
export function createAuditApi(transport: HttpTransport): AuditApi {
  return {
    async listPlans(query, options) {
      const parsedQuery = validateOrThrow(AuditPlansListQuery, query ?? {}, "audit plans query");
      return await transport.request({
        method: "GET",
        path: "/audit/plans",
        query: parsedQuery,
        response: AuditPlansListResponse,
        signal: options?.signal,
      });
    },

    async exportReceiptBundle(planId, options) {
      const parsedPlanId = validateOrThrow(NonEmptyString, planId, "plan id");
      return await transport.request({
        method: "GET",
        path: `/audit/export/${encodeURIComponent(parsedPlanId)}`,
        response: ReceiptBundle,
        signal: options?.signal,
      });
    },

    async verify(input, options) {
      const body = validateOrThrow(AuditVerifyRequest, input, "audit verify request");
      return await transport.request({
        method: "POST",
        path: "/audit/verify",
        body,
        response: ChainVerification,
        signal: options?.signal,
      });
    },

    async forget(input, options) {
      const body = validateOrThrow(AuditForgetRequest, input, "audit forget request");
      return await transport.request({
        method: "POST",
        path: "/audit/forget",
        body,
        response: AuditForgetResponse,
        signal: options?.signal,
      });
    },
  };
}
