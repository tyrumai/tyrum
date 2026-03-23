import { afterEach, describe, expect, it } from "vitest";
import type { PlanRequest } from "@tyrum/contracts";
import type { GatewayContainer } from "../../src/container.js";
import { createGatewayPlanService } from "../../src/app/modules/planner/service.js";
import { createGatewayPlanService as createGatewayPlanServiceWithDeps } from "../../src/modules/planner/service.js";
import { PlanDal } from "../../src/modules/planner/plan-dal.js";
import { DEFAULT_TENANT_ID, requirePrimaryAgentId } from "../../src/modules/identity/scope.js";
import { createTestContainer } from "../integration/helpers.js";

const DECISION_AUDIT_STEP_INDEX = 2147483647;

function buildPlanRequest(tags: string[] = []): PlanRequest {
  return {
    request_id: "test-req-1",
    trigger: {
      thread: {
        id: "thread-1",
        kind: "private",
        pii_fields: [],
      },
      message: {
        id: "msg-1",
        thread_id: "thread-1",
        source: "telegram",
        content: { text: "help me", attachments: [] },
        timestamp: "2026-01-01T00:00:00.000Z",
        pii_fields: [],
      },
    },
    tags,
  };
}

describe("gateway plan service", () => {
  const containers: GatewayContainer[] = [];

  afterEach(async () => {
    await Promise.all(
      containers.splice(0).map(async (container) => {
        await container.db.close();
      }),
    );
  });

  async function createFixture() {
    const container = await createTestContainer();
    containers.push(container);
    return {
      container,
      service: createGatewayPlanService(container),
    };
  }

  it("persists successful plans and emits completion from the service boundary", async () => {
    const { container, service } = await createFixture();
    const completedEvents: Array<{ planId: string; stepsExecuted: number }> = [];
    container.eventBus.on("plan:completed", (event) => {
      completedEvents.push(event);
    });

    const result = await service.createPlan({
      tenantId: DEFAULT_TENANT_ID,
      request: buildPlanRequest(["spend:5000:USD"]),
    });

    expect(result.planId).toMatch(/^plan-/);
    expect(result.outcome).toMatchObject({
      status: "success",
      steps: [{ type: "Research" }, { type: "Web" }, { type: "Pay" }, { type: "Message" }],
      summary: { synopsis: expect.stringContaining("authorized spend in USD") },
    });

    const persistedPlan = await new PlanDal(container.db).getByKey({
      tenantId: DEFAULT_TENANT_ID,
      planKey: result.planId,
    });
    expect(persistedPlan?.plan_id).toBeDefined();

    const auditEvents = await container.eventLog.eventsForPlan({
      tenantId: DEFAULT_TENANT_ID,
      planKey: result.planId,
    });
    expect(auditEvents).toEqual([
      expect.objectContaining({
        stepIndex: DECISION_AUDIT_STEP_INDEX,
        action: expect.objectContaining({
          request_id: "test-req-1",
          outcome_status: "success",
          policy_decision: "allow",
        }),
      }),
    ]);
    expect(completedEvents).toEqual([
      {
        planId: result.planId,
        stepsExecuted: 4,
      },
    ]);
  });

  it("returns policy escalations through the planner service", async () => {
    const { container, service } = await createFixture();
    const escalatedEvents: Array<{ planId: string; stepIndex: number }> = [];
    container.eventBus.on("plan:escalated", (event) => {
      escalatedEvents.push(event);
    });

    const result = await service.createPlan({
      tenantId: DEFAULT_TENANT_ID,
      request: buildPlanRequest(),
    });

    expect(result.outcome).toMatchObject({
      status: "escalate",
      escalation: {
        step_index: 0,
        action: { type: "Confirm" },
      },
    });

    const auditEvents = await container.eventLog.eventsForPlan({
      tenantId: DEFAULT_TENANT_ID,
      planKey: result.planId,
    });
    expect(auditEvents).toEqual([
      expect.objectContaining({
        stepIndex: DECISION_AUDIT_STEP_INDEX,
        action: expect.objectContaining({
          outcome_status: "escalate",
          policy_decision: "require_approval",
        }),
      }),
    ]);
    expect(escalatedEvents).toEqual([
      {
        planId: result.planId,
        stepIndex: 0,
      },
    ]);
  });

  it("returns wallet escalations through the planner service", async () => {
    const { container } = await createFixture();
    const service = createGatewayPlanServiceWithDeps({
      eventBus: container.eventBus,
      eventLog: container.eventLog,
      identityScopeDal: container.identityScopeDal,
      logger: container.logger,
      planDal: new PlanDal(container.db),
      resolvePrimaryAgentId: async (tenantId) =>
        await requirePrimaryAgentId(container.identityScopeDal, tenantId),
      riskClassifier: container.riskClassifier,
      policyEvaluator: (request) => ({
        decision: "allow",
        rules: [
          {
            rule: "spend_limit",
            outcome: "allow",
            detail: `Amount ${String(request.spend?.amount_minor_units ?? 0)} permitted for wallet review.`,
          },
          {
            rule: "pii_guardrail",
            outcome: "allow",
            detail: "No PII categories declared.",
          },
          {
            rule: "legal_guardrail",
            outcome: "allow",
            detail: "No legal flags declared.",
          },
        ],
      }),
    });
    const escalatedEvents: Array<{ planId: string; stepIndex: number }> = [];
    container.eventBus.on("plan:escalated", (event) => {
      escalatedEvents.push(event);
    });

    const result = await service.createPlan({
      tenantId: DEFAULT_TENANT_ID,
      request: buildPlanRequest(["spend:15000:EUR"]),
    });

    expect(result.outcome).toMatchObject({
      status: "escalate",
      escalation: {
        step_index: 2,
        action: { type: "Confirm" },
      },
    });

    const auditEvents = await container.eventLog.eventsForPlan({
      tenantId: DEFAULT_TENANT_ID,
      planKey: result.planId,
    });
    expect(auditEvents).toEqual([
      expect.objectContaining({
        stepIndex: DECISION_AUDIT_STEP_INDEX,
        action: expect.objectContaining({
          outcome_status: "escalate",
          policy_decision: "allow",
        }),
      }),
    ]);
    expect(escalatedEvents).toEqual([
      {
        planId: result.planId,
        stepIndex: 2,
      },
    ]);
  });
});
