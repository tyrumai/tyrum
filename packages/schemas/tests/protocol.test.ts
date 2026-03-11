import { describe, expect, it } from "vitest";
import {
  WsApprovalResolveRequest,
  WsApprovalListRequest,
  WsConnectRequest,
  WsEvent,
  WsResponse,
  WsEventEnvelope,
  WsMessageEnvelope,
  WsPingRequest,
  WsPlanUpdateEvent,
  WsRequest,
  WsPluginLifecycleEvent,
  WsPluginToolInvokedEvent,
  WsRequestEnvelope,
  WsResponseEnvelope,
  WsTaskExecuteRequest,
  requiredCapability,
} from "../src/protocol.js";
import { expectRejects } from "./test-helpers.js";

describe("WS envelopes", () => {
  it("parses connect request", () => {
    const msg = WsConnectRequest.parse({
      request_id: "r-1",
      type: "connect",
      payload: { capabilities: ["playwright", "http"] },
    });
    expect(msg.type).toBe("connect");
    expect(msg.payload.capabilities).toEqual(["playwright", "http"]);
  });

  it("rejects connect request missing payload", () => {
    expectRejects(WsConnectRequest, { request_id: "r-1", type: "connect" });
  });

  it("parses ping request", () => {
    const msg = WsPingRequest.parse({
      request_id: "r-2",
      type: "ping",
      payload: {},
    });
    expect(msg.type).toBe("ping");
  });

  it("rejects ping request with non-object payload", () => {
    expectRejects(WsPingRequest, { request_id: "r-2", type: "ping", payload: 123 });
  });

  it("parses task.execute request", () => {
    const msg = WsTaskExecuteRequest.parse({
      request_id: "r-3",
      type: "task.execute",
      payload: {
        run_id: "550e8400-e29b-41d4-a716-446655440000",
        step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        action: { type: "Http", args: { url: "https://example.com" } },
      },
    });
    expect(msg.payload.run_id).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(msg.payload.action.type).toBe("Http");
  });

  it("rejects task.execute request with missing action", () => {
    expectRejects(WsTaskExecuteRequest, {
      request_id: "r-3",
      type: "task.execute",
      payload: {
        run_id: "550e8400-e29b-41d4-a716-446655440000",
        step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      },
    });
  });

  it("parses approval.list request", () => {
    const msg = WsApprovalListRequest.parse({
      request_id: "r-approval-list-1",
      type: "approval.list",
      payload: { status: "pending", limit: 25 },
    });
    expect(msg.type).toBe("approval.list");
  });

  it("rejects approval.list request with invalid status", () => {
    expectRejects(WsApprovalListRequest, {
      request_id: "r-approval-list-1",
      type: "approval.list",
      payload: { status: "nope", limit: 25 },
    });
  });

  it("parses approval.resolve request", () => {
    const msg = WsApprovalResolveRequest.parse({
      request_id: "r-approval-resolve-1",
      type: "approval.resolve",
      payload: { approval_id: "550e8400-e29b-41d4-a716-446655440000", decision: "approved" },
    });
    expect(msg.payload.approval_id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("rejects approval.resolve request missing approval_id", () => {
    expectRejects(WsApprovalResolveRequest, {
      request_id: "r-approval-resolve-1",
      type: "approval.resolve",
      payload: { decision: "approved" },
    });
  });

  it("parses generic request envelope", () => {
    const msg = WsRequestEnvelope.parse({
      request_id: "r-4",
      type: "custom.op",
      payload: { x: 1 },
    });
    expect(msg.type).toBe("custom.op");
  });

  it("rejects generic request envelope missing request_id", () => {
    expectRejects(WsRequestEnvelope, { type: "custom.op", payload: { x: 1 } });
  });

  it("parses response envelope ok", () => {
    const msg = WsResponseEnvelope.parse({
      request_id: "r-5",
      type: "task.execute",
      ok: true,
      result: { evidence: { http: { status: 200 } } },
    });
    expect(msg.ok).toBe(true);
  });

  it("rejects response envelope ok with blank request_id", () => {
    expectRejects(WsResponseEnvelope, {
      request_id: "",
      type: "task.execute",
      ok: true,
    });
  });

  it("parses typed connect response", () => {
    const msg = WsResponse.parse({
      request_id: "r-connect-1",
      type: "connect",
      ok: true,
      result: { client_id: "client-1" },
    });
    expect(msg.type).toBe("connect");
  });

  it("parses response envelope error", () => {
    const msg = WsResponseEnvelope.parse({
      request_id: "r-6",
      type: "task.execute",
      ok: false,
      error: { code: "task_failed", message: "boom" },
    });
    expect(msg.ok).toBe(false);
  });

  it("parses plan.update event", () => {
    const msg = WsPlanUpdateEvent.parse({
      event_id: "e-1",
      type: "plan.update",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: { plan_id: "plan-1", status: "running", detail: "step 1" },
    });
    expect(msg.payload.plan_id).toBe("plan-1");
  });

  it("parses generic event envelope", () => {
    const msg = WsEventEnvelope.parse({
      event_id: "e-2",
      type: "something",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: { ok: true },
    });
    expect(msg.type).toBe("something");
  });

  it("parses plugin.lifecycle event", () => {
    const msg = WsPluginLifecycleEvent.parse({
      event_id: "e-plugin-1",
      type: "plugin.lifecycle",
      occurred_at: "2026-02-19T12:00:00Z",
      scope: { kind: "global" },
      payload: {
        kind: "loaded",
        plugin: {
          id: "echo",
          name: "Echo",
          version: "0.0.1",
          source_kind: "workspace",
          source_dir: "/tmp/plugins/echo",
        },
        audit: { plan_id: "gateway.plugins.lifecycle", step_index: 0, event_id: 12 },
      },
    });
    expect(msg.payload.kind).toBe("loaded");
    expect(msg.payload.plugin.id).toBe("echo");
  });

  it("parses plugin_tool.invoked event", () => {
    const msg = WsPluginToolInvokedEvent.parse({
      event_id: "e-plugin-tool-1",
      type: "plugin_tool.invoked",
      occurred_at: "2026-02-19T12:00:00Z",
      scope: { kind: "agent", agent_id: "00000000-0000-4000-8000-000000000002" },
      payload: {
        plugin_id: "echo",
        plugin_version: "0.0.1",
        tool_id: "plugin.echo.echo",
        tool_call_id: "call-1",
        agent_id: "00000000-0000-4000-8000-000000000002",
        workspace_id: "00000000-0000-4000-8000-000000000003",
        session_id: "session-1",
        channel: "local",
        thread_id: "thread-1",
        policy_snapshot_id: "550e8400-e29b-41d4-a716-446655440000",
        outcome: "succeeded",
        duration_ms: 12,
        audit: { plan_id: "agent-turn-test", step_index: 1, event_id: 13 },
      },
    });
    expect(msg.payload.tool_id).toBe("plugin.echo.echo");
    expect(msg.payload.outcome).toBe("succeeded");
  });

  it("parses thread-scoped typing events and session send cleanup events", () => {
    const typing = WsEvent.parse({
      event_id: "e-typing-1",
      type: "typing.started",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        thread_id: "thread-1",
      },
    });
    expect(typing.type).toBe("typing.started");

    const cleanup = WsEvent.parse({
      event_id: "e-session-failed-1",
      type: "session.send.failed",
      occurred_at: "2026-02-19T12:00:01Z",
      payload: {
        session_id: "session-1",
        thread_id: "thread-1",
        message_ids: ["assistant-1"],
        reasoning_ids: ["reason-1"],
      },
    });
    expect(cleanup.type).toBe("session.send.failed");
  });

  it("parses union message envelope", () => {
    const msg = WsMessageEnvelope.parse({
      request_id: "r-7",
      type: "ping",
      payload: {},
    });
    expect("request_id" in msg).toBe(true);
  });

  it("parses capability.ready request via typed union", () => {
    const msg = WsRequest.parse({
      request_id: "r-cap-ready-1",
      type: "capability.ready",
      payload: { capabilities: [{ id: "tyrum.cli", version: "1.0.0" }] },
    });
    expect(msg.type).toBe("capability.ready");
  });

  it("parses attempt.evidence request via typed union", () => {
    const msg = WsRequest.parse({
      request_id: "r-attempt-evidence-1",
      type: "attempt.evidence",
      payload: {
        run_id: "550e8400-e29b-41d4-a716-446655440000",
        step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        evidence: { http: { status: 200 } },
      },
    });
    expect(msg.type).toBe("attempt.evidence");
  });

  it("parses capability.ready event via typed union", () => {
    const msg = WsEvent.parse({
      event_id: "e-cap-ready-1",
      type: "capability.ready",
      occurred_at: "2026-02-19T12:00:00Z",
      scope: { kind: "node", node_id: "dev_test" },
      payload: { node_id: "dev_test", capabilities: [{ id: "tyrum.cli", version: "1.0.0" }] },
    });
    expect(msg.type).toBe("capability.ready");
  });

  it("parses attempt.evidence event via typed union", () => {
    const msg = WsEvent.parse({
      event_id: "e-attempt-evidence-1",
      type: "attempt.evidence",
      occurred_at: "2026-02-19T12:00:00Z",
      scope: { kind: "run", run_id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: {
        node_id: "dev_test",
        run_id: "550e8400-e29b-41d4-a716-446655440000",
        step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
        evidence: { http: { status: 200 } },
      },
    });
    expect(msg.type).toBe("attempt.evidence");
  });
});

describe("requiredCapability", () => {
  it("maps Web to playwright", () => {
    expect(requiredCapability("Web")).toBe("playwright");
  });

  it("maps Browser to browser", () => {
    expect(requiredCapability("Browser")).toBe("browser");
  });

  it("maps Http to http", () => {
    expect(requiredCapability("Http")).toBe("http");
  });

  it("maps Desktop to desktop", () => {
    expect(requiredCapability("Desktop")).toBe("desktop");
  });

  it("returns undefined for Research", () => {
    expect(requiredCapability("Research")).toBeUndefined();
  });
});
