import { CapabilityDescriptor, NodePairingTrustLevel } from "@tyrum/contracts";
import { z } from "zod";

const ReviewRiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

export const ApprovalGuardianDecisionSchema = z
  .object({
    decision: z.enum(["approve", "requested_human"]),
    reason: z.string().trim().min(1).max(2_000),
    risk_level: ReviewRiskLevelSchema,
    risk_score: z.number().min(0).max(1_000),
    evidence: z.unknown().optional(),
  })
  .strict();

export const PairingGuardianDecisionSchema = z
  .object({
    decision: z.enum(["approve", "requested_human"]),
    reason: z.string().trim().min(1).max(2_000),
    risk_level: ReviewRiskLevelSchema,
    risk_score: z.number().min(0).max(1_000),
    evidence: z.unknown().optional(),
    trust_level: NodePairingTrustLevel.optional(),
    capability_allowlist: CapabilityDescriptor.array().optional(),
  })
  .strict();

const GuardianReviewMetadataSchema = z
  .object({
    subject_type: z.enum(["approval", "pairing"]),
    target_id: z.string().trim().min(1).optional(),
  })
  .passthrough();

export type GuardianReviewSubjectType = z.infer<
  typeof GuardianReviewMetadataSchema
>["subject_type"];
export type ApprovalGuardianDecision = z.infer<typeof ApprovalGuardianDecisionSchema>;
export type PairingGuardianDecision = z.infer<typeof PairingGuardianDecisionSchema>;
export type GuardianReviewDecision = ApprovalGuardianDecision | PairingGuardianDecision;

export type GuardianReviewDecisionCollector = {
  subjectType: GuardianReviewSubjectType;
  calls: number;
  invalidCalls: number;
  lastDecision?: GuardianReviewDecision;
  lastError?: string;
};

export type GuardianReviewRequest = {
  subjectType: GuardianReviewSubjectType;
  targetId?: string;
};

const COMMON_GUARDIAN_REVIEW_RULES = [
  "Treat missing, omitted, or stale evidence as unknown, not safe.",
  "Risk score bands:",
  "- low (0-199): narrow, justified, bounded, and safe to automate when the evidence is complete.",
  "- medium (200-499): some operational risk or uncertainty; default to requested_human unless the safe automated path is still obvious and fully justified.",
  "- high (500-799): meaningful privilege, destructive potential, or unclear scope; default to requested_human.",
  "- critical (800-1000): sandbox escape, credential access, data exfiltration, broad system impact, or similarly dangerous behavior; default to requested_human.",
  "requested_human is the default whenever the evidence is incomplete, ambiguous, or the safe automated outcome is not clearly defensible.",
] as const;

function parseGuardianReviewMetadata(
  metadata: Record<string, unknown> | undefined,
): z.infer<typeof GuardianReviewMetadataSchema> | undefined {
  if (!metadata) return undefined;
  const candidate = metadata["guardian_review"];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return undefined;
  }
  const parsed = GuardianReviewMetadataSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function resolveGuardianReviewRequest(
  metadata: Record<string, unknown> | undefined,
): GuardianReviewRequest | undefined {
  const parsed = parseGuardianReviewMetadata(metadata);
  if (!parsed) return undefined;
  return {
    subjectType: parsed.subject_type,
    ...(parsed.target_id ? { targetId: parsed.target_id } : {}),
  };
}

export function createGuardianReviewDecisionCollector(
  subjectType: GuardianReviewSubjectType,
): GuardianReviewDecisionCollector {
  return {
    subjectType,
    calls: 0,
    invalidCalls: 0,
  };
}

export function getGuardianReviewDecisionSchema(subjectType: GuardianReviewSubjectType) {
  return subjectType === "approval"
    ? ApprovalGuardianDecisionSchema
    : PairingGuardianDecisionSchema;
}

export function recordGuardianReviewDecision(
  collector: GuardianReviewDecisionCollector,
  args: unknown,
): { ok: boolean; error?: string } {
  collector.calls += 1;
  const schema = getGuardianReviewDecisionSchema(collector.subjectType);
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    collector.invalidCalls += 1;
    const error = parsed.error.issues[0]?.message ?? "invalid guardian review decision";
    collector.lastError = error;
    return { ok: false, error };
  }
  collector.lastDecision = parsed.data;
  collector.lastError = undefined;
  return { ok: true };
}

export function buildGuardianReviewSystemPrompt(subjectType: GuardianReviewSubjectType): string {
  if (subjectType === "approval") {
    return [
      "You are Tyrum's guardian reviewer.",
      "You are operating in guardian review mode with no normal assistant persona.",
      "Review approval requests for safety and operational risk.",
      "Risk must be your own assessment from the request, motivation, and evidence. Ignore configured tool risk labels.",
      ...COMMON_GUARDIAN_REVIEW_RULES,
      "Approve only when the request is clearly justified, narrowly scoped, low risk, and safe for automatic execution.",
      "If there is missing context, ambiguity, privilege escalation, destructive behavior, sandbox escape, network exfiltration, credential access, or broad file/system impact, route to requested_human.",
      "Call `guardian_review_decision` exactly once. Do not answer with prose outside the tool call.",
    ].join("\n");
  }

  return [
    "You are Tyrum's guardian reviewer.",
    "You are operating in guardian review mode with no normal assistant persona.",
    "Review node pairing requests for safety and capability risk.",
    "Risk must be your own assessment from the node identity, metadata, and advertised capabilities.",
    ...COMMON_GUARDIAN_REVIEW_RULES,
    "Approve only when the node can be trusted automatically, the residual risk is low, and you can provide an exact trust_level and capability_allowlist limited to the advertised capabilities.",
    "If you are uncertain, the node looks risky, or the safe capability set is unclear, route to requested_human.",
    "Call `guardian_review_decision` exactly once. Do not answer with prose outside the tool call.",
  ].join("\n");
}
