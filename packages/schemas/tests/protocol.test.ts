import { describe, expect, it } from "vitest";
import {
  WsConnectRequest,
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
        plan_id: "plan-1",
        step_index: 0,
        action: { type: "Http", args: { url: "https://example.com" } },
      },
    });
    expect(msg.payload.plan_id).toBe("plan-1");
    expect(msg.payload.action.type).toBe("Http");
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
