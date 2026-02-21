import { describe, expect, it } from "vitest";
import {
  WsApprovalResolveRequest,
  WsApprovalListRequest,
  WsWorkflowResumeRequest,
  WsWorkflowCancelRequest,
  WsPairingApproveRequest,
  WsPairingDenyRequest,
  WsSessionSendRequest,
  WsWorkflowRunRequest,
  WS_PROTOCOL_REV,
  WsConnectInitRequest,
  WsConnectProofRequest,
  WsResponse,
  WsEventEnvelope,
  WsMessageEnvelope,
  WsPingRequest,
  WsPlanUpdateEvent,
  WsApprovalRequestedEvent,
  WsApprovalResolvedEvent,
  WsPairingRequestedEvent,
  WsPairingResolvedEvent,
  WsRunPausedEvent,
  WsRunResumedEvent,
  WsRunCancelledEvent,
  WsRequestEnvelope,
  WsResponseEnvelope,
  WsTaskExecuteRequest,
  requiredCapability,
} from "../src/protocol.js";

describe("WS envelopes", () => {
  it("parses connect.init request", () => {
    const msg = WsConnectInitRequest.parse({
      request_id: "r-1",
      type: "connect.init",
      payload: {
        protocol_rev: WS_PROTOCOL_REV,
        role: "client",
        device: { device_id: "dev-aaaaaaaa", pubkey: "pubkey" },
        capabilities: [{ name: "playwright" }, { name: "http" }],
      },
    });
    expect(msg.type).toBe("connect.init");
    expect(msg.payload.protocol_rev).toBe(WS_PROTOCOL_REV);
  });

  it("parses connect.proof request", () => {
    const msg = WsConnectProofRequest.parse({
      request_id: "r-1b",
      type: "connect.proof",
      payload: { connection_id: "conn-1", proof: "sig" },
    });
    expect(msg.type).toBe("connect.proof");
  });

  it("parses ping request", () => {
    const msg = WsPingRequest.parse({
      request_id: "r-2",
      type: "ping",
      payload: {},
    });
    expect(msg.type).toBe("ping");
  });

  it("parses session.send request", () => {
    const msg = WsSessionSendRequest.parse({
      request_id: "r-session-1",
      type: "session.send",
      payload: { channel: "internal", thread_id: "t-1", message: "hello" },
    });
    expect(msg.type).toBe("session.send");
  });

  it("parses task.execute request", () => {
    const msg = WsTaskExecuteRequest.parse({
      request_id: "r-3",
      type: "task.execute",
      payload: {
        run_id: "00000000-0000-4000-8000-000000000001",
        step_id: "00000000-0000-4000-8000-000000000002",
        attempt_id: "00000000-0000-4000-8000-000000000003",
        action: { type: "Http", args: { url: "https://example.com" } },
      },
    });
    expect(msg.payload.run_id).toBe("00000000-0000-4000-8000-000000000001");
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

  it("parses workflow.resume request", () => {
    const msg = WsWorkflowResumeRequest.parse({
      request_id: "r-workflow-resume-1",
      type: "workflow.resume",
      payload: { resume_token: "resume-123" },
    });
    expect(msg.payload.resume_token).toBe("resume-123");
  });

  it("parses workflow.run request", () => {
    const msg = WsWorkflowRunRequest.parse({
      request_id: "r-workflow-run-1",
      type: "workflow.run",
      payload: {
        key: "hook:00000000-0000-4000-8000-000000000001",
        lane: "main",
        pipeline: "id: demo\nname: Demo\nversion: 0.0.0\nsteps:\n  - id: one\n    command: cli echo hello\n",
      },
    });
    expect(msg.payload.key).toBe("hook:00000000-0000-4000-8000-000000000001");
  });

  it("parses workflow.cancel request", () => {
    const msg = WsWorkflowCancelRequest.parse({
      request_id: "r-workflow-cancel-1",
      type: "workflow.cancel",
      payload: { resume_token: "resume-123", reason: "operator cancelled" },
    });
    expect(msg.payload.resume_token).toBe("resume-123");
  });

  it("parses pairing.approve request", () => {
    const msg = WsPairingApproveRequest.parse({
      request_id: "r-pairing-approve-1",
      type: "pairing.approve",
      payload: { node_id: "node-aaaaaaaa" },
    });
    expect(msg.payload.node_id).toBe("node-aaaaaaaa");
  });

  it("parses pairing.deny request", () => {
    const msg = WsPairingDenyRequest.parse({
      request_id: "r-pairing-deny-1",
      type: "pairing.deny",
      payload: { node_id: "node-aaaaaaaa", reason: "not trusted" },
    });
    expect(msg.payload.node_id).toBe("node-aaaaaaaa");
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

  it("parses typed connect.init response", () => {
    const msg = WsResponse.parse({
      request_id: "r-connect-init-1",
      type: "connect.init",
      ok: true,
      result: { connection_id: "conn-1", challenge: "nonce" },
    });
    expect(msg.type).toBe("connect.init");
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

  it("parses approval.requested event", () => {
    const msg = WsApprovalRequestedEvent.parse({
      event_id: "e-approval-1",
      type: "approval.requested",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        approval: {
          approval_id: 1,
          kind: "other",
          status: "pending",
          prompt: "Approve?",
          created_at: "2026-02-19T12:00:00Z",
          resolution: null,
        },
      },
    });
    expect(msg.payload.approval.approval_id).toBe(1);
  });

  it("parses approval.resolved event", () => {
    const msg = WsApprovalResolvedEvent.parse({
      event_id: "e-approval-2",
      type: "approval.resolved",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        approval: {
          approval_id: 1,
          kind: "other",
          status: "approved",
          prompt: "Approve?",
          created_at: "2026-02-19T12:00:00Z",
          resolution: { decision: "approved", resolved_at: "2026-02-19T12:00:00Z" },
        },
      },
    });
    expect(msg.payload.approval.status).toBe("approved");
  });

  it("parses pairing.requested event", () => {
    const msg = WsPairingRequestedEvent.parse({
      event_id: "e-pair-1",
      type: "pairing.requested",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        pairing: {
          pairing_id: 1,
          status: "pending",
          requested_at: "2026-02-19T12:00:00Z",
          node: {
            node_id: "node-aaaaaaaa",
            label: "Node",
            capabilities: ["cli"],
            last_seen_at: "2026-02-19T12:00:00Z",
          },
          resolution: null,
          resolved_at: null,
        },
      },
    });
    expect(msg.payload.pairing.node.node_id).toBe("node-aaaaaaaa");
  });

  it("parses pairing.resolved event", () => {
    const msg = WsPairingResolvedEvent.parse({
      event_id: "e-pair-2",
      type: "pairing.resolved",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        pairing: {
          pairing_id: 1,
          status: "approved",
          requested_at: "2026-02-19T12:00:00Z",
          node: {
            node_id: "node-aaaaaaaa",
            label: "Node",
            capabilities: ["cli"],
            last_seen_at: "2026-02-19T12:00:00Z",
          },
          resolution: { decision: "approved", resolved_at: "2026-02-19T12:00:00Z" },
          resolved_at: "2026-02-19T12:00:00Z",
        },
      },
    });
    expect(msg.payload.pairing.status).toBe("approved");
  });

  it("parses run lifecycle events", () => {
    const paused = WsRunPausedEvent.parse({
      event_id: "e-run-1",
      type: "run.paused",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: { run_id: "00000000-0000-4000-8000-000000000001", reason: "approval" },
    });
    expect(paused.payload.reason).toBe("approval");

    const resumed = WsRunResumedEvent.parse({
      event_id: "e-run-2",
      type: "run.resumed",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: { run_id: "00000000-0000-4000-8000-000000000001" },
    });
    expect(resumed.payload.run_id).toBe("00000000-0000-4000-8000-000000000001");

    const cancelled = WsRunCancelledEvent.parse({
      event_id: "e-run-3",
      type: "run.cancelled",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: { run_id: "00000000-0000-4000-8000-000000000001", reason: "operator" },
    });
    expect(cancelled.payload.reason).toBe("operator");
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
