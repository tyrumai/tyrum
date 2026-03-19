import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";

export const ReviewId = UuidSchema;
export type ReviewId = z.infer<typeof ReviewId>;

export const ReviewTargetType = z.enum(["approval", "pairing"]);
export type ReviewTargetType = z.infer<typeof ReviewTargetType>;

export const ReviewerKind = z.enum(["guardian", "human", "system"]);
export type ReviewerKind = z.infer<typeof ReviewerKind>;

export const ReviewState = z.enum([
  "queued",
  "running",
  "requested_human",
  "approved",
  "denied",
  "expired",
  "cancelled",
  "revoked",
  "failed",
  "superseded",
]);
export type ReviewState = z.infer<typeof ReviewState>;

export const ReviewRiskLevel = z.enum(["low", "medium", "high", "critical"]);
export type ReviewRiskLevel = z.infer<typeof ReviewRiskLevel>;

export const ReviewEntry = z
  .object({
    review_id: ReviewId,
    target_type: ReviewTargetType,
    target_id: z.string().trim().min(1),
    reviewer_kind: ReviewerKind,
    reviewer_id: z.string().trim().min(1).nullable(),
    state: ReviewState,
    reason: z.string().trim().min(1).nullable(),
    risk_level: ReviewRiskLevel.nullable(),
    risk_score: z.number().min(0).max(1_000).nullable(),
    evidence: z.unknown().nullable(),
    decision_payload: z.unknown().nullable(),
    created_at: DateTimeSchema,
    started_at: DateTimeSchema.nullable(),
    completed_at: DateTimeSchema.nullable(),
  })
  .strict();
export type ReviewEntry = z.infer<typeof ReviewEntry>;
