import { describe, expect, it } from "vitest";
import * as Schemas from "../src/index.js";
import * as Protocol from "../src/protocol.js";
import { WsEvent, WsRequest, WsResponse } from "../src/protocol.js";
import { expectRejects } from "./test-helpers.js";

describe("Subagent WS protocol", () => {
  it("exports Subagent schemas from @tyrum/schemas", () => {
    expect("SubagentId" in Schemas).toBe(true);
    expect("SubagentStatus" in Schemas).toBe(true);
    expect("SubagentDescriptor" in Schemas).toBe(true);
  });

  it("exports subagent.* WS operation/event schemas from ../src/protocol.js", () => {
    expect("WsSubagentSpawnRequest" in Protocol).toBe(true);
    expect("WsSubagentSpawnedEvent" in Protocol).toBe(true);
  });

  it("parses subagent.* requests via WsRequest union", () => {
    const scope = { tenant_id: "t-1", agent_id: "agent-1", workspace_id: "default" };
    const subagentId = "123e4567-e89b-12d3-a456-426614174000";
    const workItemId = "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e";
    const workItemTaskId = "550e8400-e29b-41d4-a716-446655440000";

    const requests: Array<{ type: string; payload: unknown }> = [
      {
        type: "subagent.spawn",
        payload: {
          ...scope,
          execution_profile: "executor",
          work_item_id: workItemId,
          work_item_task_id: workItemTaskId,
        },
      },
      { type: "subagent.list", payload: scope },
      { type: "subagent.get", payload: { ...scope, subagent_id: subagentId } },
      { type: "subagent.send", payload: { ...scope, subagent_id: subagentId, content: "hello" } },
      { type: "subagent.close", payload: { ...scope, subagent_id: subagentId, reason: "done" } },
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

  it("parses subagent.* responses via WsResponse union", () => {
    const scope = { tenant_id: "t-1", agent_id: "agent-1", workspace_id: "default" };
    const subagentId = "123e4567-e89b-12d3-a456-426614174000";
    const workItemId = "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e";
    const workItemTaskId = "550e8400-e29b-41d4-a716-446655440000";
    const sessionKey = `agent:${scope.agent_id}:subagent:${subagentId}`;

    const subagent = {
      subagent_id: subagentId,
      ...scope,
      work_item_id: workItemId,
      work_item_task_id: workItemTaskId,
      execution_profile: "executor",
      session_key: sessionKey,
      lane: "subagent",
      status: "running",
      created_at: "2026-02-19T12:00:00Z",
      last_heartbeat_at: "2026-02-19T12:00:00Z",
    };

    const responses: Array<{ type: string; result?: unknown }> = [
      { type: "subagent.spawn", result: { subagent } },
      { type: "subagent.list", result: { subagents: [subagent] } },
      { type: "subagent.get", result: { subagent } },
      { type: "subagent.send", result: { accepted: true } },
      { type: "subagent.close", result: { subagent: { ...subagent, status: "closed" } } },
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

    const errorResponses: Array<{ type: string }> = [
      { type: "subagent.spawn" },
      { type: "subagent.list" },
      { type: "subagent.get" },
      { type: "subagent.send" },
      { type: "subagent.close" },
    ];

    for (const entry of errorResponses) {
      const parsed = WsResponse.safeParse({
        request_id: `r-err-${entry.type}`,
        type: entry.type,
        ok: false,
        error: { code: "bad_request", message: "boom" },
      });
      expect(parsed.success, entry.type).toBe(true);
    }
  });

  it("parses subagent.* events via WsEvent union", () => {
    const scope = { tenant_id: "t-1", agent_id: "agent-1", workspace_id: "default" };
    const subagentId = "123e4567-e89b-12d3-a456-426614174000";
    const workItemId = "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e";
    const workItemTaskId = "550e8400-e29b-41d4-a716-446655440000";
    const sessionKey = `agent:${scope.agent_id}:subagent:${subagentId}`;

    const subagent = {
      subagent_id: subagentId,
      ...scope,
      work_item_id: workItemId,
      work_item_task_id: workItemTaskId,
      execution_profile: "executor",
      session_key: sessionKey,
      lane: "subagent",
      status: "running",
      created_at: "2026-02-19T12:00:00Z",
      last_heartbeat_at: "2026-02-19T12:00:00Z",
    };

    const events: Array<{ type: string; payload: unknown }> = [
      { type: "subagent.spawned", payload: { subagent } },
      { type: "subagent.updated", payload: { subagent } },
      { type: "subagent.closed", payload: { subagent: { ...subagent, status: "closed" } } },
      {
        type: "subagent.output",
        payload: {
          ...scope,
          subagent_id: subagentId,
          work_item_id: workItemId,
          work_item_task_id: workItemTaskId,
          kind: "log",
          content: "hello",
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

  it("rejects subagent.* request envelopes missing payload", () => {
    expectRejects(WsRequest, { request_id: "r-missing", type: "subagent.list" });
  });

  it("rejects error responses missing error payload", () => {
    expectRejects(WsResponse, { request_id: "r-missing-error", type: "subagent.list", ok: false });
  });
});
