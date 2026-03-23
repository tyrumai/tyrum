import { expect, it, vi } from "vitest";
import type { WorkItem } from "@tyrum/contracts";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { RedactionEngine } from "../../src/modules/redaction/engine.js";
import {
  completePendingInterventionApprovals,
  createCapturedWorkItem,
  emitItemEvent,
} from "../../src/modules/workboard/service-support.js";
import { createMockWs } from "./ws-workboard.test-support.js";

function makeItem(overrides?: Partial<WorkItem>): WorkItem {
  return {
    work_item_id: "00000000-0000-4000-8000-000000000111",
    tenant_id: DEFAULT_TENANT_ID,
    agent_id: DEFAULT_AGENT_ID,
    workspace_id: DEFAULT_WORKSPACE_ID,
    kind: "action",
    title: "Item title",
    status: "backlog",
    priority: 0,
    created_at: "2026-03-20T00:00:00.000Z",
    created_from_session_key: "agent:default:test:default:channel:thread-service-support",
    last_active_at: null,
    updated_at: "2026-03-20T00:00:00.000Z",
    ...overrides,
  };
}

it("broadcasts work item events directly to connected client peers when protocol deps are present", async () => {
  const connectionManager = new ConnectionManager();
  const clientWs = createMockWs();
  connectionManager.addClient(
    clientWs as never,
    [] as never,
    {
      authClaims: {
        token_kind: "admin",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      },
      role: "client",
    } as never,
  );
  const db = { run: vi.fn() } as never;

  await emitItemEvent({
    db,
    protocolDeps: { connectionManager },
    type: "work.item.created",
    item: makeItem(),
  });

  expect(clientWs.send).toHaveBeenCalledTimes(1);
  expect(JSON.parse(clientWs.send.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
    type: "work.item.created",
    payload: { item: { work_item_id: "00000000-0000-4000-8000-000000000111" } },
  });
  expect(db.run).not.toHaveBeenCalled();
});

it("falls back to outbox broadcast payloads and redacts secrets without protocol deps", async () => {
  const db = { run: vi.fn(async () => undefined) } as never;
  const redactionEngine = new RedactionEngine();
  redactionEngine.registerSecrets(["super-secret"]);

  await emitItemEvent({
    db,
    redactionEngine,
    type: "work.item.updated",
    item: makeItem({ title: "Contains super-secret", status: "ready" }),
  });

  expect(db.run).toHaveBeenCalledTimes(1);
  const payloadJson = db.run.mock.calls[0]?.[1]?.[3];
  expect(typeof payloadJson).toBe("string");
  expect(JSON.parse(String(payloadJson))).toMatchObject({
    audience: { roles: ["client"] },
    message: {
      type: "work.item.updated",
      payload: { item: { title: "Contains [REDACTED]", status: "ready" } },
    },
  });
});

it("creates captured work items with planner bootstrap state", async () => {
  const db = { run: vi.fn(async () => undefined) } as never;
  const scope = {
    tenant_id: DEFAULT_TENANT_ID,
    agent_id: DEFAULT_AGENT_ID,
    workspace_id: DEFAULT_WORKSPACE_ID,
  } as const;
  const item = makeItem();
  const workboard = {
    createItem: vi.fn(async () => item),
    createTask: vi.fn(async () => undefined),
    setStateKv: vi.fn(async () => undefined),
    appendEvent: vi.fn(async () => undefined),
  } as never;

  const created = await createCapturedWorkItem({
    workboard,
    db,
    scope,
    item: {
      kind: "action",
      title: "Captured",
      created_from_session_key: item.created_from_session_key,
    },
    captureEvent: { kind: "work.capture.manual", payload_json: { source: "test" } },
  });

  expect(created).toEqual(item);
  expect(workboard.createTask).toHaveBeenCalledWith({
    scope,
    task: expect.objectContaining({
      work_item_id: item.work_item_id,
      status: "queued",
      execution_profile: "planner",
    }),
  });
  expect(workboard.setStateKv).toHaveBeenCalledTimes(2);
  expect(workboard.setStateKv).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      key: "work.refinement.phase",
      value_json: "new",
    }),
  );
  expect(workboard.setStateKv).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      key: "work.dispatch.phase",
      value_json: "unassigned",
    }),
  );
  expect(workboard.appendEvent).toHaveBeenCalledWith({
    scope,
    work_item_id: item.work_item_id,
    kind: "work.capture.manual",
    payload_json: { source: "test" },
  });
});

it("resolves queued work intervention approvals through the approval DAL", async () => {
  const db = {
    all: vi.fn(async () => [
      { approval_id: "00000000-0000-4000-8000-000000000301" },
      { approval_id: "00000000-0000-4000-8000-000000000302" },
    ]),
  } as never;
  const transitionWithReview = vi
    .fn()
    .mockResolvedValueOnce({ transitioned: true })
    .mockResolvedValueOnce({ transitioned: false });

  await completePendingInterventionApprovals({
    db,
    scope: {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    },
    workItemId: "00000000-0000-4000-8000-000000000111",
    decision: "approved",
    reason: "resume",
    approvalDal: { transitionWithReview } as never,
  });

  expect(transitionWithReview).toHaveBeenCalledTimes(2);
  expect(transitionWithReview).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      approvalId: "00000000-0000-4000-8000-000000000301",
      status: "approved",
      reviewerKind: "system",
    }),
  );
});

it("does not re-export runtime-owned operator helpers", async () => {
  const serviceSupportModule = await import("../../src/modules/workboard/service-support.js");

  expect(serviceSupportModule).not.toHaveProperty("assertItemMutable");
  expect(serviceSupportModule).not.toHaveProperty("cancelPausedTasks");
  expect(serviceSupportModule).not.toHaveProperty("closePausedSubagents");
  expect(serviceSupportModule).not.toHaveProperty("getTransitionEventType");
});
