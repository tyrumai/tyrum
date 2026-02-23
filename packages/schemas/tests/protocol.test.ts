import { describe, expect, it } from "vitest";
import {
  WsApprovalResolveRequest,
  WsApprovalListRequest,
  WsConnectRequest,
  WsResponse,
  WsEventEnvelope,
  WsMessageEnvelope,
  WsPingRequest,
  WsPlanUpdateEvent,
  WsRequestEnvelope,
  WsResponseEnvelope,
  WsTaskExecuteRequest,
  requiredCapability,
} from "../src/protocol.js";

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

  it("parses ping request", () => {
    const msg = WsPingRequest.parse({
      request_id: "r-2",
      type: "ping",
      payload: {},
    });
    expect(msg.type).toBe("ping");
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

  it("parses approval.list request", () => {
    const msg = WsApprovalListRequest.parse({
      request_id: "r-approval-list-1",
      type: "approval.list",
      payload: { status: "pending", limit: 25 },
    });
    expect(msg.type).toBe("approval.list");
  });

  it("parses approval.resolve request", () => {
    const msg = WsApprovalResolveRequest.parse({
      request_id: "r-approval-resolve-1",
      type: "approval.resolve",
      payload: { approval_id: 7, decision: "approved" },
    });
    expect(msg.payload.approval_id).toBe(7);
  });

  it("parses generic request envelope", () => {
    const msg = WsRequestEnvelope.parse({
      request_id: "r-4",
      type: "custom.op",
      payload: { x: 1 },
    });
    expect(msg.type).toBe("custom.op");
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

  it("parses union message envelope", () => {
    const msg = WsMessageEnvelope.parse({
      request_id: "r-7",
      type: "ping",
      payload: {},
    });
    expect("request_id" in msg).toBe(true);
  });
});

describe("requiredCapability", () => {
  it("maps Web to playwright", () => {
    expect(requiredCapability("Web")).toBe("playwright");
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
