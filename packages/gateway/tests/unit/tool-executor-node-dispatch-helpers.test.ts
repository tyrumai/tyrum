import { describe, expect, it } from "vitest";
import {
  normalizeExecutionFailure,
  selectPayload,
} from "../../src/modules/agent/tool-executor-node-dispatch-helpers.js";
import {
  NoCapableNodeError,
  NodeNotConnectedError,
  NodeNotReadyError,
  UnknownNodeError,
} from "../../src/ws/protocol/errors.js";

describe("normalizeExecutionFailure", () => {
  it("marks disconnected nodes as retryable runtime failures", () => {
    expect(normalizeExecutionFailure(new NodeNotConnectedError("node-1"))).toEqual({
      code: "runtime_unavailable",
      message: "node is not connected: node-1",
      retryable: true,
    });
  });

  it("marks not-ready nodes as retryable runtime failures", () => {
    expect(normalizeExecutionFailure(new NodeNotReadyError("node-1", "desktop"))).toEqual({
      code: "runtime_unavailable",
      message: "node 'node-1' is not ready for capability: desktop",
      retryable: true,
    });
  });

  it("marks dropped task connections as retryable runtime failures", () => {
    expect(normalizeExecutionFailure(new Error("task connection disconnected: conn-1"))).toEqual({
      code: "runtime_unavailable",
      message: "task connection disconnected: conn-1",
      retryable: true,
    });
  });

  it("keeps non-transient runtime availability errors non-retryable", () => {
    expect(normalizeExecutionFailure(new UnknownNodeError("node-1"))).toEqual({
      code: "runtime_unavailable",
      message: "unknown node: node-1",
      retryable: false,
    });
    expect(normalizeExecutionFailure(new NoCapableNodeError("desktop"))).toEqual({
      code: "runtime_unavailable",
      message: "no connected node with capability: desktop",
      retryable: false,
    });
  });
});

describe("selectPayload", () => {
  it("falls back to result when result_or_evidence gets null evidence", () => {
    expect(selectPayload("result_or_evidence", { ok: true }, null)).toEqual({
      payload_source: "result",
      payload: { ok: true },
    });
  });

  it("returns none when result_or_evidence receives only nullish payloads", () => {
    expect(selectPayload("result_or_evidence", null, null)).toEqual({
      payload_source: "none",
      payload: null,
    });
    expect(selectPayload("result_or_evidence", undefined, undefined)).toEqual({
      payload_source: "none",
      payload: null,
    });
  });

  it("preserves explicit null for the result channel", () => {
    expect(selectPayload("result", null, { ignored: true })).toEqual({
      payload_source: "result",
      payload: null,
    });
  });

  it("preserves explicit null for the evidence channel", () => {
    expect(selectPayload("evidence", { ignored: true }, null)).toEqual({
      payload_source: "evidence",
      payload: null,
    });
  });
});
