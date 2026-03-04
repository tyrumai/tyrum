import { describe, expect, it } from "vitest";
import * as Schemas from "../src/index.js";
import * as Protocol from "../src/protocol.js";
import { WsEvent, WsRequest, WsResponse } from "../src/protocol.js";
import { expectRejects } from "./test-helpers.js";

describe("WorkBoard WS protocol", () => {
  it("exports WorkBoard schemas from @tyrum/schemas", () => {
    expect("WorkItem" in Schemas).toBe(true);
    expect("WorkItemFingerprint" in Schemas).toBe(true);
    expect("WorkItemTask" in Schemas).toBe(true);
    expect("WorkItemLink" in Schemas).toBe(true);
    expect("WorkArtifact" in Schemas).toBe(true);
    expect("DecisionRecord" in Schemas).toBe(true);
    expect("WorkSignal" in Schemas).toBe(true);
    expect("AgentStateKVEntry" in Schemas).toBe(true);
    expect("WorkItemStateKVEntry" in Schemas).toBe(true);
  });

  it("exports work.* WS operation/event schemas from ../src/protocol.js", () => {
    expect("WsWorkListRequest" in Protocol).toBe(true);
    expect("WsWorkItemCreatedEvent" in Protocol).toBe(true);
  });

  it("parses work.* requests via WsRequest union", () => {
    const scope = { tenant_key: "default", agent_key: "default", workspace_key: "default" };
    const workItemId = "123e4567-e89b-12d3-a456-426614174000";
    const linkedWorkItemId = "123e4567-e89b-12d3-a456-426614174001";
    const artifactId = "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e";
    const decisionId = "550e8400-e29b-41d4-a716-446655440000";
    const signalId = "11111111-2222-3333-8aaa-555555555555";

    const requests: Array<{ type: string; payload: unknown }> = [
      { type: "work.list", payload: scope },
      { type: "work.get", payload: { ...scope, work_item_id: workItemId } },
      {
        type: "work.create",
        payload: { ...scope, item: { kind: "action", title: "Test item" } },
      },
      { type: "work.update", payload: { ...scope, work_item_id: workItemId, patch: {} } },
      {
        type: "work.transition",
        payload: { ...scope, work_item_id: workItemId, status: "doing" },
      },

      {
        type: "work.link.create",
        payload: {
          ...scope,
          work_item_id: workItemId,
          linked_work_item_id: linkedWorkItemId,
          kind: "depends_on",
        },
      },
      { type: "work.link.list", payload: { ...scope, work_item_id: workItemId } },

      { type: "work.artifact.list", payload: { ...scope, work_item_id: workItemId } },
      { type: "work.artifact.get", payload: { ...scope, artifact_id: artifactId } },
      {
        type: "work.artifact.create",
        payload: { ...scope, artifact: { kind: "candidate_plan", title: "Plan" } },
      },

      { type: "work.decision.list", payload: { ...scope, work_item_id: workItemId } },
      { type: "work.decision.get", payload: { ...scope, decision_id: decisionId } },
      {
        type: "work.decision.create",
        payload: {
          ...scope,
          decision: { question: "Q?", chosen: "A", rationale_md: "Because" },
        },
      },

      { type: "work.signal.list", payload: { ...scope, work_item_id: workItemId } },
      { type: "work.signal.get", payload: { ...scope, signal_id: signalId } },
      {
        type: "work.signal.create",
        payload: {
          ...scope,
          signal: { trigger_kind: "time", trigger_spec_json: { at: "tomorrow" } },
        },
      },
      { type: "work.signal.update", payload: { ...scope, signal_id: signalId, patch: {} } },

      {
        type: "work.state_kv.get",
        payload: { scope: { ...scope, kind: "agent" }, key: "prefs.timezone" },
      },
      {
        type: "work.state_kv.list",
        payload: { scope: { ...scope, kind: "work_item", work_item_id: workItemId } },
      },
      {
        type: "work.state_kv.set",
        payload: {
          scope: { ...scope, kind: "work_item", work_item_id: workItemId },
          key: "branch",
          value_json: { name: "main" },
        },
      },
    ];

    for (const entry of requests) {
      const parsed = WsRequest.safeParse({
        request_id: `r-${entry.type}`,
        type: entry.type,
        payload: entry.payload,
      });
      expect(parsed.success, entry.type).toBe(true);
    }
  });

  it("parses work.* responses via WsResponse union", () => {
    const scope = {
      tenant_id: "00000000-0000-4000-8000-000000000001",
      agent_id: "00000000-0000-4000-8000-000000000002",
      workspace_id: "00000000-0000-4000-8000-000000000003",
    };
    const workItem = {
      work_item_id: "123e4567-e89b-12d3-a456-426614174000",
      ...scope,
      kind: "action",
      title: "Test item",
      status: "backlog",
      priority: 0,
      created_at: "2026-02-19T12:00:00Z",
      created_from_session_key: "agent:default:main",
      last_active_at: null,
      fingerprint: { resources: ["repo:example/repo"] },
      acceptance: { checks: [] },
      budgets: null,
      parent_work_item_id: null,
    };

    const workItemLink = {
      work_item_id: workItem.work_item_id,
      linked_work_item_id: "123e4567-e89b-12d3-a456-426614174001",
      kind: "depends_on",
      meta_json: { note: "blocks" },
      created_at: "2026-02-19T12:00:00Z",
    };

    const workArtifact = {
      artifact_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      ...scope,
      work_item_id: workItem.work_item_id,
      kind: "candidate_plan",
      title: "Plan",
      body_md: "- step 1",
      refs: [],
      created_at: "2026-02-19T12:00:00Z",
    };

    const decision = {
      decision_id: "550e8400-e29b-41d4-a716-446655440000",
      ...scope,
      work_item_id: workItem.work_item_id,
      question: "Q?",
      chosen: "A",
      alternatives: ["B"],
      rationale_md: "Because",
      input_artifact_ids: [workArtifact.artifact_id],
      created_at: "2026-02-19T12:00:00Z",
    };

    const signal = {
      signal_id: "11111111-2222-3333-8aaa-555555555555",
      ...scope,
      work_item_id: workItem.work_item_id,
      trigger_kind: "time",
      trigger_spec_json: { at: "tomorrow" },
      payload_json: { note: "ping" },
      status: "active",
      created_at: "2026-02-19T12:00:00Z",
      last_fired_at: null,
    };

    const responses: Array<{ type: string; result?: unknown }> = [
      { type: "work.list", result: { items: [workItem], next_cursor: "cursor-1" } },
      { type: "work.get", result: { item: workItem } },
      { type: "work.create", result: { item: workItem } },
      { type: "work.update", result: { item: workItem } },
      { type: "work.transition", result: { item: workItem } },

      { type: "work.link.create", result: { link: workItemLink } },
      { type: "work.link.list", result: { links: [workItemLink] } },

      {
        type: "work.artifact.list",
        result: { artifacts: [workArtifact], next_cursor: "cursor-2" },
      },
      { type: "work.artifact.get", result: { artifact: workArtifact } },
      { type: "work.artifact.create", result: { artifact: workArtifact } },

      {
        type: "work.decision.list",
        result: { decisions: [decision], next_cursor: "cursor-3" },
      },
      { type: "work.decision.get", result: { decision } },
      { type: "work.decision.create", result: { decision } },

      {
        type: "work.signal.list",
        result: { signals: [signal], next_cursor: "cursor-4" },
      },
      { type: "work.signal.get", result: { signal } },
      { type: "work.signal.create", result: { signal } },
      { type: "work.signal.update", result: { signal } },

      { type: "work.state_kv.get", result: { entry: null } },
      { type: "work.state_kv.list", result: { entries: [] } },
      {
        type: "work.state_kv.set",
        result: {
          entry: {
            ...scope,
            work_item_id: workItem.work_item_id,
            key: "branch",
            value_json: { name: "main" },
            updated_at: "2026-02-19T12:00:00Z",
          },
        },
      },
    ];

    for (const entry of responses) {
      const parsed = WsResponse.safeParse({
        request_id: `r-${entry.type}`,
        type: entry.type,
        ok: true,
        result: entry.result,
      });
      expect(parsed.success, entry.type).toBe(true);
    }
  });

  it("parses work.* events via WsEvent union", () => {
    const scope = {
      tenant_id: "00000000-0000-4000-8000-000000000001",
      agent_id: "00000000-0000-4000-8000-000000000002",
      workspace_id: "00000000-0000-4000-8000-000000000003",
    };
    const scopeKeys = { tenant_key: "default", agent_key: "default", workspace_key: "default" };
    const workItem = {
      work_item_id: "123e4567-e89b-12d3-a456-426614174000",
      ...scope,
      kind: "action",
      title: "Test item",
      status: "backlog",
      priority: 0,
      created_at: "2026-02-19T12:00:00Z",
      created_from_session_key: "agent:default:main",
      last_active_at: null,
      fingerprint: { resources: ["repo:example/repo"] },
      acceptance: { checks: [] },
      budgets: null,
      parent_work_item_id: null,
    };

    const workItemLink = {
      work_item_id: workItem.work_item_id,
      linked_work_item_id: "123e4567-e89b-12d3-a456-426614174001",
      kind: "depends_on",
      meta_json: {},
      created_at: "2026-02-19T12:00:00Z",
    };

    const workArtifact = {
      artifact_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      ...scope,
      work_item_id: workItem.work_item_id,
      kind: "candidate_plan",
      title: "Plan",
      body_md: "- step 1",
      refs: [],
      created_at: "2026-02-19T12:00:00Z",
    };

    const decision = {
      decision_id: "550e8400-e29b-41d4-a716-446655440000",
      ...scope,
      work_item_id: workItem.work_item_id,
      question: "Q?",
      chosen: "A",
      alternatives: ["B"],
      rationale_md: "Because",
      input_artifact_ids: [workArtifact.artifact_id],
      created_at: "2026-02-19T12:00:00Z",
    };

    const signal = {
      signal_id: "11111111-2222-3333-8aaa-555555555555",
      ...scope,
      work_item_id: workItem.work_item_id,
      trigger_kind: "time",
      trigger_spec_json: { at: "tomorrow" },
      payload_json: { note: "ping" },
      status: "active",
      created_at: "2026-02-19T12:00:00Z",
      last_fired_at: null,
    };

    const events: Array<{ type: string; payload: unknown }> = [
      { type: "work.item.created", payload: { item: workItem } },
      { type: "work.item.updated", payload: { item: workItem } },
      { type: "work.item.blocked", payload: { item: workItem } },
      { type: "work.item.completed", payload: { item: workItem } },
      { type: "work.item.cancelled", payload: { item: workItem } },

      { type: "work.link.created", payload: { ...scope, link: workItemLink } },

      {
        type: "work.task.leased",
        payload: {
          ...scope,
          work_item_id: workItem.work_item_id,
          task_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          lease_expires_at_ms: 1,
        },
      },
      {
        type: "work.task.started",
        payload: {
          ...scope,
          work_item_id: workItem.work_item_id,
          task_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          run_id: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
      {
        type: "work.task.paused",
        payload: {
          ...scope,
          work_item_id: workItem.work_item_id,
          task_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          approval_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      },
      {
        type: "work.task.completed",
        payload: {
          ...scope,
          work_item_id: workItem.work_item_id,
          task_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
          result_summary: "ok",
        },
      },

      { type: "work.artifact.created", payload: { artifact: workArtifact } },
      { type: "work.decision.created", payload: { decision } },
      { type: "work.signal.created", payload: { signal } },
      { type: "work.signal.updated", payload: { signal } },
      {
        type: "work.signal.fired",
        payload: { ...scope, signal_id: signal.signal_id, firing_id: "f-1" },
      },
      {
        type: "work.state_kv.updated",
        payload: {
          scope: { ...scopeKeys, kind: "agent" },
          key: "prefs.timezone",
          updated_at: "2026-02-19T12:00:00Z",
        },
      },
    ];

    for (const entry of events) {
      const parsed = WsEvent.safeParse({
        event_id: `e-${entry.type}`,
        type: entry.type,
        occurred_at: "2026-02-19T12:00:00Z",
        payload: entry.payload,
      });
      expect(parsed.success, entry.type).toBe(true);
    }
  });

  it("rejects work.* request envelopes missing payload", () => {
    expectRejects(WsRequest, { request_id: "r-missing-payload", type: "work.list" });
  });

  it("rejects work.* error responses missing error payload", () => {
    expectRejects(WsResponse, { request_id: "r-missing-error", type: "work.list", ok: false });
  });
});
