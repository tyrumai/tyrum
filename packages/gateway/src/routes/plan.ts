import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { PlanRequest as PlanRequestSchema } from "@tyrum/contracts";
import type {
  PlanRequest,
  PlanOutcome,
  PlanResponse,
  PlanEscalation,
  PlanError,
  ActionPrimitive,
  PolicyDecision,
  RiskSpendContext,
} from "@tyrum/contracts";
import type { GatewayContainer } from "../container.js";
import { evaluatePolicy } from "../modules/policy/engine.js";
import { authorizeWithThresholds, defaultThresholds } from "../modules/wallet/authorization.js";
import { PlanDal } from "../modules/planner/plan-dal.js";
import { DEFAULT_AGENT_KEY, DEFAULT_WORKSPACE_KEY } from "../modules/identity/scope.js";
import { requireTenantId } from "../modules/auth/claims.js";

const DECISION_AUDIT_STEP_INDEX = 2147483647; // i32::MAX
const WALLET_GUARDRAIL_NOTE = "Spend guardrail enforced by wallet authorization.";

function formatPlanId(): string {
  return `plan-${randomUUID().replace(/-/g, "")}`;
}

function sanitizeDetail(detail: string): string {
  return detail.replace(/\d/g, "*");
}

interface SpendDirective {
  amountMinorUnits: number;
  currency: string;
  merchant?: string;
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
  const steps: ActionPrimitive[] = [];
  steps.push(researchStep());
  steps.push(fallbackExecutionStep());
  if (spendDirective) {
    steps.push(walletPayStep(spendDirective));
  }
  steps.push(followUpStep(request));
  return steps;
}

function buildPolicyEscalation(decision: PolicyDecision): PlanEscalation {
  let relevantRules = decision.rules.filter((r) => r.outcome === "require_approval");
  if (relevantRules.length === 0) {
    relevantRules = decision.rules;
  }

  const rationaleText = relevantRules.map((r) => `${r.rule}: ${r.detail}`).join("\n");

  const context = {
    decision: "escalate",
    rules: relevantRules.map((r) => ({ rule: r.rule, detail: r.detail })),
  };

  return {
    step_index: 0,
    action: {
      type: "Confirm",
      args: {
        prompt: "Policy review required before execution.",
        context,
      },
    },
    rationale: rationaleText || undefined,
  };
}

function buildPolicyFailure(decision: PolicyDecision): PlanError {
  let relevantRules = decision.rules.filter((r) => r.outcome === "deny");
  if (relevantRules.length === 0) {
    relevantRules = decision.rules;
  }

  const detail =
    relevantRules.length === 0
      ? undefined
      : relevantRules.map((r) => `${r.rule}: ${sanitizeDetail(r.detail)}`).join("\n") || undefined;

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

interface SpendRequest {
  stepIndex: number;
  amountMinorUnits: number;
  currency: string;
  merchant?: string;
}

function firstSpendRequest(steps: ActionPrimitive[]): SpendRequest | undefined {
  for (let idx = 0; idx < steps.length; idx++) {
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

function spendRequestToContext(req: SpendRequest): RiskSpendContext {
  return {
    amount_minor_units: req.amountMinorUnits,
    currency: req.currency,
    merchant: req.merchant,
  };
}

function directiveToSpendContext(directive: SpendDirective): RiskSpendContext {
  return {
    amount_minor_units: directive.amountMinorUnits,
    currency: directive.currency,
    merchant: directive.merchant,
  };
}

export function createPlanRoutes(container: GatewayContainer): Hono {
  const plan = new Hono();

  plan.post("/plan", async (c) => {
    const body: unknown = await c.req.json();
    const parsed = PlanRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const request = parsed.data;

    if (request.request_id.trim() === "") {
      return c.json({ error: "invalid_request", message: "request_id must not be empty" }, 400);
    }

    const planId = formatPlanId();
    const spendDirective = extractSpendDirective(request);
    let capturedSpend: RiskSpendContext | undefined;

    const policyRequest = {
      request_id: request.request_id,
      spend: spendDirective
        ? {
            amount_minor_units: spendDirective.amountMinorUnits,
            currency: spendDirective.currency,
          }
        : undefined,
      pii: { categories: [] },
      legal: { flags: [] },
    };

    const policyDecision = evaluatePolicy(policyRequest);

    let outcome: PlanOutcome;

    switch (policyDecision.decision) {
      case "allow": {
        const steps = buildPlanSteps(request, spendDirective);

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
          const walletRequest = {
            request_id: planId,
            amount_minor_units: spend.amountMinorUnits,
            currency: spend.currency,
          };

          const walletResponse = authorizeWithThresholds(walletRequest, defaultThresholds());
          const sanitizedReason = sanitizeDetail(walletResponse.reason);

          switch (walletResponse.decision) {
            case "approve":
              break;
            case "escalate":
              outcome = {
                status: "escalate",
                escalation: buildWalletEscalation(spend.stepIndex, sanitizedReason),
              };
              container.eventBus.emit("plan:escalated", {
                planId,
                stepIndex: spend.stepIndex,
              });
              break;
            case "deny":
              outcome = {
                status: "failure",
                error: buildWalletDenialError(sanitizedReason),
              };
              container.eventBus.emit("plan:failed", {
                planId,
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
        container.eventBus.emit("plan:escalated", {
          planId,
          stepIndex: 0,
        });
        break;

      case "deny":
        outcome = {
          status: "failure",
          error: buildPolicyFailure(policyDecision),
        };
        container.eventBus.emit("plan:failed", {
          planId,
          reason: "policy_denied",
        });
        break;
    }
    const riskSpend =
      capturedSpend ?? (spendDirective ? directiveToSpendContext(spendDirective) : undefined);
    const riskVerdict = container.riskClassifier.classify({
      tags: request.tags,
      spend: riskSpend,
    });
    const auditPayload = {
      plan_id: planId,
      request_id: request.request_id,
      policy_decision: policyDecision.decision,
      risk: riskVerdict,
      outcome_status: outcome.status,
    };

    const tenantId = requireTenantId(c);
    const planKey = planId;

    const agentId = await container.identityScopeDal.ensureAgentId(tenantId, DEFAULT_AGENT_KEY);
    const workspaceId = await container.identityScopeDal.ensureWorkspaceId(
      tenantId,
      DEFAULT_WORKSPACE_KEY,
    );
    await container.identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);

    try {
      await new PlanDal(container.db).ensurePlanId({
        tenantId,
        planKey,
        agentId,
        workspaceId,
        kind: "planner",
        status: outcome.status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      container.logger.warn("plan.ensure_failed", { plan_key: planKey, error: message });
    }

    try {
      await container.eventLog.append({
        tenantId,
        replayId: randomUUID(),
        planKey,
        stepIndex: DECISION_AUDIT_STEP_INDEX,
        occurredAt: new Date().toISOString(),
        action: auditPayload,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      container.logger.warn("plan.audit_persist_failed", { plan_key: planKey, error: message });
    }

    if (outcome.status === "success") {
      container.eventBus.emit("plan:completed", { planId, stepsExecuted: outcome.steps.length });
    }
    const response: PlanResponse = {
      plan_id: planId,
      request_id: request.request_id,
      created_at: new Date().toISOString(),
      trace_id: randomUUID(),
      ...outcome,
    };

    container.logger.info("plan.created", {
      request_id: response.request_id,
      plan_id: response.plan_id,
      trace_id: response.trace_id,
      policy_decision: policyDecision.decision,
      outcome_status: outcome.status,
      steps_count: outcome.status === "success" ? outcome.steps.length : 0,
    });

    return c.json(response);
  });

  return plan;
}
