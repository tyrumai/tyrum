import { randomUUID } from "node:crypto";
import { evaluatePolicy } from "@tyrum/runtime-policy";
import type {
  ActionPrimitive,
  PlanError,
  PlanEscalation,
  PlanOutcome,
  PlanRequest,
  PolicyDecision,
  RiskSpendContext,
} from "@tyrum/contracts";
import type { EventBus } from "../../event-bus.js";
import type { IdentityScopeDal } from "../identity/scope.js";
import type { Logger } from "../observability/logger.js";
import type { RiskClassifier } from "../risk/classifier.js";
import type { EventLog } from "./event-log.js";
import type { PlanDal } from "./plan-dal.js";
import { DEFAULT_WORKSPACE_KEY } from "../identity/scope.js";
import { authorizeWithThresholds, defaultThresholds } from "../wallet/authorization.js";

const DECISION_AUDIT_STEP_INDEX = 2147483647; // i32::MAX
const WALLET_GUARDRAIL_NOTE = "Spend guardrail enforced by wallet authorization.";

interface SpendDirective {
  amountMinorUnits: number;
  currency: string;
  merchant?: string;
}

interface SpendRequest {
  stepIndex: number;
  amountMinorUnits: number;
  currency: string;
  merchant?: string;
}

interface PlanOutcomeResolution {
  outcome: PlanOutcome;
  policyDecision: PolicyDecision;
  riskSpend: RiskSpendContext | undefined;
}

type PlanDalLike = Pick<PlanDal, "ensurePlanId">;
type EventLogLike = Pick<EventLog, "append">;
type IdentityScopeDalLike = Pick<IdentityScopeDal, "ensureMembership" | "ensureWorkspaceId">;
type RiskClassifierLike = Pick<RiskClassifier, "classify">;
type EventBusLike = Pick<EventBus, "emit">;
type LoggerLike = Pick<Logger, "info" | "warn">;

export interface GatewayPlanServiceDeps {
  eventBus: EventBusLike;
  eventLog: EventLogLike;
  identityScopeDal: IdentityScopeDalLike;
  logger: LoggerLike;
  planDal: PlanDalLike;
  resolvePrimaryAgentId: (tenantId: string) => Promise<string>;
  riskClassifier: RiskClassifierLike;
  now?: () => Date;
  createPlanId?: () => string;
  createReplayId?: () => string;
  createTraceId?: () => string;
  policyEvaluator?: typeof evaluatePolicy;
  walletAuthorizer?: typeof authorizeWithThresholds;
  walletThresholds?: ReturnType<typeof defaultThresholds>;
}

export interface GatewayPlanServiceResult {
  planId: string;
  requestId: string;
  createdAt: string;
  traceId: string;
  outcome: PlanOutcome;
}

export interface GatewayPlanService {
  createPlan(input: { tenantId: string; request: PlanRequest }): Promise<GatewayPlanServiceResult>;
}

function formatPlanId(): string {
  return `plan-${randomUUID().replace(/-/g, "")}`;
}

function sanitizeDetail(detail: string): string {
  return detail.replace(/\d/g, "*");
}

function parseSpendTag(tag: string): SpendDirective | undefined {
  const remainder = tag.startsWith("spend:") ? tag.slice(6) : undefined;
  if (!remainder) return undefined;

  const parts = remainder.split(":");
  const amountStr = parts[0];
  const currency = parts[1];
  if (!amountStr || !currency) return undefined;

  const amountMinorUnits = parseInt(amountStr, 10);
  if (isNaN(amountMinorUnits)) return undefined;

  const merchantRaw = parts[2];
  const merchant = merchantRaw ? merchantRaw.replace(/_/g, " ") || undefined : undefined;

  return {
    amountMinorUnits,
    currency: currency.toUpperCase(),
    merchant,
  };
}

function extractSpendDirective(request: PlanRequest): SpendDirective | undefined {
  for (const tag of request.tags) {
    const directive = parseSpendTag(tag);
    if (directive) return directive;
  }
  return undefined;
}

function guardrailMessage(reason: string): string {
  if (!reason) return WALLET_GUARDRAIL_NOTE;
  return `${reason}\n${WALLET_GUARDRAIL_NOTE}`;
}

function researchStep(): ActionPrimitive {
  return {
    type: "Research",
    args: {
      intent: "collect_clarifying_details",
      notes: "Review memory and prior commitments",
    },
  };
}

function fallbackExecutionStep(): ActionPrimitive {
  return {
    type: "Web",
    args: {
      executor: "generic-web",
      intent: "fallback_automation",
    },
    postcondition: {
      assertions: [{ type: "dom_contains", text: "<" }],
      metadata: { status: "completed", executor: "generic-web" },
    },
  };
}

function followUpStep(request: PlanRequest): ActionPrimitive {
  return {
    type: "Message",
    args: {
      channel: "internal",
      body: `Summarize discovery path for single-user workspace request ${request.request_id}`,
    },
    postcondition: { status: "queued" },
  };
}

function walletPayStep(directive: SpendDirective): ActionPrimitive {
  const args: Record<string, unknown> = {
    amount_minor_units: directive.amountMinorUnits,
    currency: directive.currency,
  };
  if (directive.merchant) {
    args["merchant"] = directive.merchant;
  }
  return {
    type: "Pay",
    args,
    postcondition: {
      status: "authorized",
      provider: "wallet_stub",
    },
  };
}

function buildPlanSteps(
  request: PlanRequest,
  spendDirective: SpendDirective | undefined,
): ActionPrimitive[] {
  const steps: ActionPrimitive[] = [researchStep(), fallbackExecutionStep()];
  if (spendDirective) {
    steps.push(walletPayStep(spendDirective));
  }
  steps.push(followUpStep(request));
  return steps;
}

function buildPolicyEscalation(decision: PolicyDecision): PlanEscalation {
  let relevantRules = decision.rules.filter((rule) => rule.outcome === "require_approval");
  if (relevantRules.length === 0) {
    relevantRules = decision.rules;
  }

  const rationaleText = relevantRules.map((rule) => `${rule.rule}: ${rule.detail}`).join("\n");

  return {
    step_index: 0,
    action: {
      type: "Confirm",
      args: {
        prompt: "Policy review required before execution.",
        context: {
          decision: "escalate",
          rules: relevantRules.map((rule) => ({ rule: rule.rule, detail: rule.detail })),
        },
      },
    },
    rationale: rationaleText || undefined,
  };
}

function buildPolicyFailure(decision: PolicyDecision): PlanError {
  let relevantRules = decision.rules.filter((rule) => rule.outcome === "deny");
  if (relevantRules.length === 0) {
    relevantRules = decision.rules;
  }

  const detail =
    relevantRules.length === 0
      ? undefined
      : relevantRules.map((rule) => `${rule.rule}: ${sanitizeDetail(rule.detail)}`).join("\n") ||
        undefined;

  return {
    code: "policy_denied",
    message: "Policy gate denied the plan",
    detail,
    retryable: false,
  };
}

function buildWalletEscalation(stepIndex: number, sanitizedReason: string): PlanEscalation {
  return {
    step_index: stepIndex,
    action: {
      type: "Confirm",
      args: {
        prompt: "Confirm wallet spend before continuing execution.",
        context: {
          decision: "escalate",
          reason: sanitizedReason,
          note: WALLET_GUARDRAIL_NOTE,
        },
      },
    },
    rationale: guardrailMessage(sanitizedReason),
  };
}

function buildWalletDenialError(sanitizedReason: string): PlanError {
  return {
    code: "policy_denied",
    message: "Wallet authorization denied",
    detail: guardrailMessage(sanitizedReason),
    retryable: false,
  };
}

function firstSpendRequest(steps: ActionPrimitive[]): SpendRequest | undefined {
  for (let idx = 0; idx < steps.length; idx += 1) {
    const step = steps[idx]!;
    if (step.type !== "Pay") continue;

    const amount = step.args["amount_minor_units"];
    const currency = step.args["currency"];
    if (typeof amount !== "number" || typeof currency !== "string") continue;

    const merchant = step.args["merchant"];
    return {
      stepIndex: idx,
      amountMinorUnits: amount,
      currency,
      merchant: typeof merchant === "string" ? merchant : undefined,
    };
  }
  return undefined;
}

function spendRequestToContext(request: SpendRequest): RiskSpendContext {
  return {
    amount_minor_units: request.amountMinorUnits,
    currency: request.currency,
    merchant: request.merchant,
  };
}

function directiveToSpendContext(directive: SpendDirective): RiskSpendContext {
  return {
    amount_minor_units: directive.amountMinorUnits,
    currency: directive.currency,
    merchant: directive.merchant,
  };
}

function resolvePlanOutcome(input: {
  eventBus: EventBusLike;
  planId: string;
  policyEvaluator: typeof evaluatePolicy;
  request: PlanRequest;
  walletAuthorizer: typeof authorizeWithThresholds;
  walletThresholds: ReturnType<typeof defaultThresholds>;
}): PlanOutcomeResolution {
  const spendDirective = extractSpendDirective(input.request);
  let capturedSpend: RiskSpendContext | undefined;

  const policyDecision = input.policyEvaluator({
    request_id: input.request.request_id,
    spend: spendDirective
      ? {
          amount_minor_units: spendDirective.amountMinorUnits,
          currency: spendDirective.currency,
        }
      : undefined,
    pii: { categories: [] },
    legal: { flags: [] },
  });

  let outcome: PlanOutcome;

  switch (policyDecision.decision) {
    case "allow": {
      const steps = buildPlanSteps(input.request, spendDirective);
      const synopsis = "Falling back to automation for the local workspace";
      const spendSuffix = spendDirective
        ? `; collect authorized spend in ${spendDirective.currency}`
        : "";

      outcome = {
        status: "success",
        steps,
        summary: { synopsis: `${synopsis}${spendSuffix}` },
      };

      const spend = firstSpendRequest(steps);
      if (spend) {
        capturedSpend = spendRequestToContext(spend);
        const walletResponse = input.walletAuthorizer(
          {
            request_id: input.planId,
            amount_minor_units: spend.amountMinorUnits,
            currency: spend.currency,
          },
          input.walletThresholds,
        );
        const sanitizedReason = sanitizeDetail(walletResponse.reason);

        switch (walletResponse.decision) {
          case "approve":
            break;
          case "escalate":
            outcome = {
              status: "escalate",
              escalation: buildWalletEscalation(spend.stepIndex, sanitizedReason),
            };
            input.eventBus.emit("plan:escalated", {
              planId: input.planId,
              stepIndex: spend.stepIndex,
            });
            break;
          case "deny":
            outcome = {
              status: "failure",
              error: buildWalletDenialError(sanitizedReason),
            };
            input.eventBus.emit("plan:failed", {
              planId: input.planId,
              reason: "wallet_denied",
            });
            break;
        }
      }
      break;
    }
    case "require_approval":
      outcome = {
        status: "escalate",
        escalation: buildPolicyEscalation(policyDecision),
      };
      input.eventBus.emit("plan:escalated", {
        planId: input.planId,
        stepIndex: 0,
      });
      break;
    case "deny":
      outcome = {
        status: "failure",
        error: buildPolicyFailure(policyDecision),
      };
      input.eventBus.emit("plan:failed", {
        planId: input.planId,
        reason: "policy_denied",
      });
      break;
  }

  return {
    outcome,
    policyDecision,
    riskSpend:
      capturedSpend ?? (spendDirective ? directiveToSpendContext(spendDirective) : undefined),
  };
}

async function ensurePlannerPlanRecord(input: {
  agentId: string;
  identityScopeDal: IdentityScopeDalLike;
  logger: LoggerLike;
  planDal: PlanDalLike;
  planId: string;
  tenantId: string;
  outcomeStatus: PlanOutcome["status"];
}) {
  const workspaceId = await input.identityScopeDal.ensureWorkspaceId(
    input.tenantId,
    DEFAULT_WORKSPACE_KEY,
  );
  await input.identityScopeDal.ensureMembership(input.tenantId, input.agentId, workspaceId);

  try {
    await input.planDal.ensurePlanId({
      tenantId: input.tenantId,
      planKey: input.planId,
      agentId: input.agentId,
      workspaceId,
      kind: "planner",
      status: input.outcomeStatus,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.logger.warn("plan.ensure_failed", { plan_key: input.planId, error: message });
  }
}

async function appendDecisionAudit(input: {
  eventLog: EventLogLike;
  logger: LoggerLike;
  occurredAt: string;
  planId: string;
  replayId: string;
  tenantId: string;
  action: Record<string, unknown>;
}) {
  try {
    await input.eventLog.append({
      tenantId: input.tenantId,
      replayId: input.replayId,
      planKey: input.planId,
      stepIndex: DECISION_AUDIT_STEP_INDEX,
      occurredAt: input.occurredAt,
      action: input.action,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.logger.warn("plan.audit_persist_failed", { plan_key: input.planId, error: message });
  }
}

export function createGatewayPlanService(deps: GatewayPlanServiceDeps): GatewayPlanService {
  const policyEvaluator = deps.policyEvaluator ?? evaluatePolicy;
  const walletAuthorizer = deps.walletAuthorizer ?? authorizeWithThresholds;

  return {
    async createPlan(input) {
      const now = deps.now?.() ?? new Date();
      const createdAt = now.toISOString();
      const planId = deps.createPlanId?.() ?? formatPlanId();
      const traceId = deps.createTraceId?.() ?? randomUUID();
      const replayId = deps.createReplayId?.() ?? randomUUID();
      const walletThresholds = deps.walletThresholds ?? defaultThresholds();

      const resolved = resolvePlanOutcome({
        eventBus: deps.eventBus,
        planId,
        policyEvaluator,
        request: input.request,
        walletAuthorizer,
        walletThresholds,
      });
      const riskVerdict = deps.riskClassifier.classify({
        tags: input.request.tags,
        spend: resolved.riskSpend,
      });

      const agentId = await deps.resolvePrimaryAgentId(input.tenantId);
      await ensurePlannerPlanRecord({
        agentId,
        identityScopeDal: deps.identityScopeDal,
        logger: deps.logger,
        planDal: deps.planDal,
        planId,
        tenantId: input.tenantId,
        outcomeStatus: resolved.outcome.status,
      });

      await appendDecisionAudit({
        eventLog: deps.eventLog,
        logger: deps.logger,
        occurredAt: createdAt,
        planId,
        replayId,
        tenantId: input.tenantId,
        action: {
          plan_id: planId,
          request_id: input.request.request_id,
          policy_decision: resolved.policyDecision.decision,
          risk: riskVerdict,
          outcome_status: resolved.outcome.status,
        },
      });

      if (resolved.outcome.status === "success") {
        deps.eventBus.emit("plan:completed", {
          planId,
          stepsExecuted: resolved.outcome.steps.length,
        });
      }

      deps.logger.info("plan.created", {
        request_id: input.request.request_id,
        plan_id: planId,
        trace_id: traceId,
        policy_decision: resolved.policyDecision.decision,
        outcome_status: resolved.outcome.status,
        steps_count: resolved.outcome.status === "success" ? resolved.outcome.steps.length : 0,
      });

      return {
        planId,
        requestId: input.request.request_id,
        createdAt,
        traceId,
        outcome: resolved.outcome,
      };
    },
  };
}
