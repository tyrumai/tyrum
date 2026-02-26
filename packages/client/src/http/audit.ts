import {
  AuditEvent,
  AuditForgetRequest,
  AuditForgetResponse,
  ChainVerification,
  ReceiptBundle,
} from "@tyrum/schemas";
import { z } from "zod";
import { HttpTransport, NonEmptyString, validateOrThrow, type TyrumRequestOptions } from "./shared.js";

const AuditVerifyRequest = z
  .object({
    events: z.array(AuditEvent),
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

