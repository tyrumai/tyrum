import {
  AuditForgetRequest,
  AuditForgetResponse,
  ChainVerification,
  DateTimeSchema,
  ReceiptBundle,
  Sha256Hex,
} from "@tyrum/schemas";
import { z } from "zod";
import { HttpTransport, NonEmptyString, validateOrThrow, type TyrumRequestOptions } from "./shared.js";

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

export type AuditExportResult = z.output<typeof ReceiptBundle>;
export type AuditVerifyInput = z.input<typeof AuditVerifyRequest>;
export type AuditVerifyResult = z.output<typeof ChainVerification>;
export type AuditForgetInput = z.input<typeof AuditForgetRequest>;
export type AuditForgetResult = z.output<typeof AuditForgetResponse>;

export interface AuditApi {
  exportReceiptBundle(planId: string, options?: TyrumRequestOptions): Promise<AuditExportResult>;
  verify(input: AuditVerifyInput, options?: TyrumRequestOptions): Promise<AuditVerifyResult>;
  forget(input: AuditForgetInput, options?: TyrumRequestOptions): Promise<AuditForgetResult>;
}

export function createAuditApi(transport: HttpTransport): AuditApi {
  return {
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
