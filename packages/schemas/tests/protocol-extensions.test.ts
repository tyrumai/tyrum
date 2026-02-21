import { describe, expect, it } from "vitest";
import {
  WsConnectInitRequest,
  WsConnectProofRequest,
  WsWorkflowRunRequest,
  WsWorkflowResumeRequest,
  WsWorkflowCancelRequest,
  WsRequest,
} from "../src/protocol.js";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const AGENT_KEY = "agent:bot1:telegram:main";

describe("WsConnectInitRequest", () => {
  it("parses a valid connect.init", () => {
    const msg = WsConnectInitRequest.parse({
      request_id: "r-1",
      type: "connect.init",
      payload: {
        protocol_rev: "v2",
        capabilities: ["cli"],
      },
    });
    expect(msg.type).toBe("connect.init");
    expect(msg.payload.protocol_rev).toBe("v2");
  });

  it("defaults capabilities to empty array", () => {
    const msg = WsConnectInitRequest.parse({
      request_id: "r-2",
      type: "connect.init",
      payload: { protocol_rev: "v1" },
    });
    expect(msg.payload.capabilities).toEqual([]);
  });

  it("rejects invalid protocol_rev", () => {
    expect(() =>
      WsConnectInitRequest.parse({
        request_id: "r-3",
        type: "connect.init",
        payload: { protocol_rev: "v3" },
      }),
    ).toThrow();
  });
});

describe("WsConnectProofRequest", () => {
  it("parses a valid connect.proof", () => {
    const msg = WsConnectProofRequest.parse({
      request_id: "r-4",
      type: "connect.proof",
      payload: {
        challenge_id: "ch-1",
        proof: "signed-data",
      },
    });
    expect(msg.type).toBe("connect.proof");
    expect(msg.payload.challenge_id).toBe("ch-1");
  });

  it("rejects missing proof", () => {
    expect(() =>
      WsConnectProofRequest.parse({
        request_id: "r-5",
        type: "connect.proof",
        payload: { challenge_id: "ch-2" },
      }),
    ).toThrow();
  });
});

describe("WsWorkflowRunRequest", () => {
  it("parses a valid workflow.run", () => {
    const msg = WsWorkflowRunRequest.parse({
      request_id: "r-6",
      type: "workflow.run",
      payload: {
        key: AGENT_KEY,
        steps: [{ type: "Http", args: { url: "https://example.com" } }],
        trigger: { kind: "manual" },
      },
    });
    expect(msg.type).toBe("workflow.run");
    expect(msg.payload.steps).toHaveLength(1);
  });
});

describe("WsWorkflowResumeRequest", () => {
  it("parses a valid workflow.resume", () => {
    const msg = WsWorkflowResumeRequest.parse({
      request_id: "r-7",
      type: "workflow.resume",
      payload: {
        run_id: UUID,
        resume_token: "tok-1",
      },
    });
    expect(msg.type).toBe("workflow.resume");
  });
});

describe("WsWorkflowCancelRequest", () => {
  it("parses a valid workflow.cancel", () => {
    const msg = WsWorkflowCancelRequest.parse({
      request_id: "r-8",
      type: "workflow.cancel",
      payload: { run_id: UUID },
    });
    expect(msg.type).toBe("workflow.cancel");
  });
});

describe("WsRequest discriminated union", () => {
  it("dispatches connect.init", () => {
    const msg = WsRequest.parse({
      request_id: "r-9",
      type: "connect.init",
      payload: { protocol_rev: "v1" },
    });
    expect(msg.type).toBe("connect.init");
  });

  it("dispatches workflow.run", () => {
    const msg = WsRequest.parse({
      request_id: "r-10",
      type: "workflow.run",
      payload: {
        key: AGENT_KEY,
        steps: [{ type: "Research", args: {} }],
        trigger: { kind: "api" },
      },
    });
    expect(msg.type).toBe("workflow.run");
  });

  it("still dispatches existing types", () => {
    const msg = WsRequest.parse({
      request_id: "r-11",
      type: "ping",
      payload: {},
    });
    expect(msg.type).toBe("ping");
  });
});
