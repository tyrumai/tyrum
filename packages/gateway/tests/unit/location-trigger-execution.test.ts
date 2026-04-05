import { describe, expect, it, vi } from "vitest";
import type { LocationEvent } from "@tyrum/contracts";
import { PolicyService } from "@tyrum/runtime-policy";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  IdentityScopeDal,
} from "../../src/modules/identity/scope.js";
import { buildLocationTriggerConversationKey } from "../../src/modules/automation/conversation-routing.js";
import type { LocationAutomationTriggerRecord } from "../../src/modules/location/types.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";
import { createGatewayConfigStore } from "../../src/modules/runtime-state/gateway-config-store.js";
import {
  fireLocationTriggers,
  matchesTrigger,
} from "../../src/modules/location/trigger-execution.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

function buildEvent(overrides: Partial<LocationEvent>, type: LocationEvent["type"]): LocationEvent {
  return {
    event_id: "11111111-1111-4111-8111-111111111111",
    agent_key: "default",
    node_id: "node-mobile-1",
    sample_id: "22222222-2222-4222-8222-222222222222",
    type,
    transition: "enter",
    occurred_at: "2026-03-11T10:00:00.000Z",
    place_id: "33333333-3333-4333-8333-333333333333",
    place_name: "Home",
    provider_place_id: "osm:123",
    category_key: "grocery",
    distance_m: 42,
    coords: {
      latitude: 52.3676,
      longitude: 4.9041,
      accuracy_m: 10,
    },
    metadata: {},
    ...overrides,
  };
}

function buildTrigger(
  overrides: Partial<LocationAutomationTriggerRecord>,
): LocationAutomationTriggerRecord {
  return {
    trigger_id: "44444444-4444-4444-8444-444444444444",
    agent_key: "default",
    workspace_key: "default",
    enabled: true,
    delivery_mode: "notify",
    trigger_type: "location",
    condition: {
      type: "saved_place",
      place_id: "33333333-3333-4333-8333-333333333333",
      transition: "enter",
    },
    execution: { kind: "agent_turn", instruction: "Do the thing" },
    created_at: "2026-03-11T10:00:00.000Z",
    updated_at: "2026-03-11T10:00:00.000Z",
    ...overrides,
  };
}

function createPolicyService(db: ReturnType<typeof openTestSqliteDb>): PolicyService {
  return new PolicyService({
    snapshotDal: new PolicySnapshotDal(db),
    overrideDal: new PolicyOverrideDal(db),
    configStore: createGatewayConfigStore({ db }),
  });
}

describe("matchesTrigger", () => {
  it("matches a saved-place trigger only for saved-place events", () => {
    const trigger: LocationAutomationTriggerRecord = {
      trigger_id: "44444444-4444-4444-8444-444444444444",
      agent_key: "default",
      workspace_key: "default",
      enabled: true,
      delivery_mode: "notify",
      trigger_type: "location",
      condition: {
        type: "saved_place",
        place_id: "33333333-3333-4333-8333-333333333333",
        transition: "enter",
      },
      execution: { kind: "agent_turn", instruction: "Do the thing" },
      created_at: "2026-03-11T10:00:00.000Z",
      updated_at: "2026-03-11T10:00:00.000Z",
    };

    expect(matchesTrigger(trigger, buildEvent({}, "saved_place.enter"))).toBe(true);
    expect(matchesTrigger(trigger, buildEvent({}, "poi_category.enter"))).toBe(false);
  });

  it("matches a poi-category trigger only for poi-category events", () => {
    const trigger: LocationAutomationTriggerRecord = {
      trigger_id: "55555555-5555-4555-8555-555555555555",
      agent_key: "default",
      workspace_key: "default",
      enabled: true,
      delivery_mode: "notify",
      trigger_type: "location",
      condition: {
        type: "poi_category",
        category_key: "grocery",
        transition: "enter",
      },
      execution: { kind: "agent_turn", instruction: "Buy milk" },
      created_at: "2026-03-11T10:00:00.000Z",
      updated_at: "2026-03-11T10:00:00.000Z",
    };

    expect(matchesTrigger(trigger, buildEvent({}, "poi_category.enter"))).toBe(true);
    expect(matchesTrigger(trigger, buildEvent({}, "saved_place.enter"))).toBe(false);
  });
});

describe("fireLocationTriggers", () => {
  it("persists matching location triggers as queued workflow runs before turns materialize", async () => {
    const db = openTestSqliteDb();
    const identityScopeDal = new IdentityScopeDal(db);
    const policyService = createPolicyService(db);
    const loadEffectiveBundleSpy = vi.spyOn(policyService, "loadEffectiveBundle");

    try {
      const trigger = buildTrigger({
        execution: { kind: "agent_turn", instruction: "Fallback action" },
      });
      await fireLocationTriggers({
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        event: buildEvent({}, "saved_place.enter"),
        triggers: [trigger],
        dal: {} as never,
        db,
        identityScopeDal,
        policyService,
        playbooksById: new Map(),
        playbookRunner: {} as never,
      });

      const workflowRun = await db.get<{
        workflow_run_id: string;
        run_key: string;
        conversation_key: string | null;
        status: string;
        trigger_json: string;
      }>(
        `SELECT workflow_run_id, run_key, conversation_key, status, trigger_json
         FROM workflow_runs
         WHERE tenant_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [DEFAULT_TENANT_ID],
      );
      const expectedConversationKey = buildLocationTriggerConversationKey({
        agentKey: trigger.agent_key,
        workspaceKey: trigger.workspace_key,
        triggerId: trigger.trigger_id,
      });

      expect(workflowRun).toMatchObject({
        run_key: expectedConversationKey,
        conversation_key: expectedConversationKey,
        status: "queued",
      });
      expect(JSON.parse(workflowRun!.trigger_json)).toMatchObject({
        kind: "manual",
        metadata: {
          location_trigger: {
            trigger_id: trigger.trigger_id,
            event_id: "11111111-1111-4111-8111-111111111111",
          },
        },
      });

      const stepCount = await db.get<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM workflow_run_steps
         WHERE tenant_id = ? AND workflow_run_id = ?`,
        [DEFAULT_TENANT_ID, workflowRun!.workflow_run_id],
      );
      expect(stepCount?.count).toBe(1);

      const turnCount = await db.get<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM turns
         WHERE tenant_id = ? AND turn_id = ?`,
        [DEFAULT_TENANT_ID, workflowRun!.workflow_run_id],
      );
      expect(turnCount?.count).toBe(0);
      expect(loadEffectiveBundleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
        }),
      );
    } finally {
      await db.close();
    }
  });

  it("continues dispatching later matching triggers when one fails", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const db = openTestSqliteDb();
    const identityScopeDal = new IdentityScopeDal(db);
    const policyService = createPolicyService(db);
    const loadEffectiveBundleSpy = vi.spyOn(policyService, "loadEffectiveBundle");

    try {
      await expect(
        fireLocationTriggers({
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          event: buildEvent({}, "saved_place.enter"),
          triggers: [
            buildTrigger({
              execution: { kind: "playbook", playbook_id: "missing-playbook" },
            }),
            buildTrigger({
              trigger_id: "55555555-5555-4555-8555-555555555555",
              execution: { kind: "agent_turn", instruction: "Fallback action" },
            }),
          ],
          dal: {} as never,
          db,
          identityScopeDal,
          policyService,
          playbooksById: new Map(),
          playbookRunner: {} as never,
        }),
      ).resolves.toBeUndefined();

      const workflowRunCount = await db.get<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM workflow_runs
         WHERE tenant_id = ?`,
        [DEFAULT_TENANT_ID],
      );
      expect(workflowRunCount?.count).toBe(1);
      expect(logSpy).toHaveBeenCalled();
      expect(loadEffectiveBundleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
        }),
      );
    } finally {
      await db.close();
    }
  });
});
