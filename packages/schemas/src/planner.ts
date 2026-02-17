import { z } from "zod";
import { NormalizedThreadMessage } from "./message.js";

/** Parameters passed to an ActionPrimitive invocation. */
export const ActionArguments = z.record(z.string(), z.unknown());
export type ActionArguments = z.infer<typeof ActionArguments>;

/** Arbitrary predicate describing evidence expected after an action. */
export const ActionPostcondition = z.unknown();
export type ActionPostcondition = z.infer<typeof ActionPostcondition>;

/** Supported action primitive kinds. */
export const ActionPrimitiveKind = z.enum([
  "Research",
  "Decide",
  "Web",
  "Android",
  "CLI",
  "Http",
  "Message",
  "Pay",
  "Store",
  "Watch",
  "Confirm",
  "Desktop",
]);
export type ActionPrimitiveKind = z.infer<typeof ActionPrimitiveKind>;

/** Kinds that mutate external state and require a postcondition. */
const REQUIRES_POSTCONDITION = new Set<ActionPrimitiveKind>([
  "Web",
  "Android",
  "CLI",
  "Http",
  "Message",
  "Pay",
  "Store",
  "Watch",
  "Desktop",
]);

/** Returns true when the primitive mutates external state. */
export function requiresPostcondition(kind: ActionPrimitiveKind): boolean {
  return REQUIRES_POSTCONDITION.has(kind);
}

/** Neutral action representation exchanged between planner and executors. */
export const ActionPrimitive = z.object({
  type: ActionPrimitiveKind,
  args: ActionArguments.default({}),
  postcondition: ActionPostcondition.optional(),
  idempotency_key: z.string().optional(),
});
export type ActionPrimitive = z.infer<typeof ActionPrimitive>;

/** Canonical request envelope accepted by the planner service. */
export const PlanRequest = z.object({
  request_id: z.string(),
  trigger: NormalizedThreadMessage,
  locale: z.string().optional(),
  timezone: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
export type PlanRequest = z.infer<typeof PlanRequest>;

/** Success metadata summarising the generated plan. */
export const PlanSummary = z.object({
  synopsis: z.string().optional(),
});
export type PlanSummary = z.infer<typeof PlanSummary>;

/** Escalation payload when the planner needs human confirmation. */
export const PlanEscalation = z.object({
  step_index: z.number().int().nonnegative(),
  action: ActionPrimitive,
  rationale: z.string().optional(),
  expires_at: z.string().datetime().optional(),
});
export type PlanEscalation = z.infer<typeof PlanEscalation>;

/** Canonical planner error codes. */
export const PlanErrorCode = z.enum([
  "invalid_request",
  "policy_denied",
  "executor_unavailable",
  "internal",
]);
export type PlanErrorCode = z.infer<typeof PlanErrorCode>;

/** Structured planner error. */
export const PlanError = z.object({
  code: PlanErrorCode,
  message: z.string(),
  detail: z.string().optional(),
  retryable: z.boolean().default(false),
});
export type PlanError = z.infer<typeof PlanError>;

/** Result envelope describing the planner outcome — discriminated on `status`. */
export const PlanOutcome = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    steps: z.array(ActionPrimitive),
    summary: PlanSummary,
  }),
  z.object({
    status: z.literal("escalate"),
    escalation: PlanEscalation,
  }),
  z.object({
    status: z.literal("failure"),
    error: PlanError,
  }),
]);
export type PlanOutcome = z.infer<typeof PlanOutcome>;

/** Planner response envelope. Outcome fields are flattened into the top level. */
export const PlanResponse = z
  .object({
    plan_id: z.string(),
    request_id: z.string(),
    created_at: z.string().datetime(),
    trace_id: z.string().optional(),
  })
  .and(PlanOutcome);
export type PlanResponse = z.infer<typeof PlanResponse>;
