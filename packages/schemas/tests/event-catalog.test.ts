import { describe, expect, it } from "vitest";
import { WsEvent } from "../src/protocol.js";
import { expectRejects } from "./test-helpers.js";

describe("WS event catalog", () => {
  it("parses artifact.fetched", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-1",
      type: "artifact.fetched",
      occurred_at: "2026-02-19T12:00:00Z",
      scope: { kind: "run", run_id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: {
        artifact: {
          artifact_id: "123e4567-e89b-12d3-a456-426614174000",
          uri: "artifact://123e4567-e89b-12d3-a456-426614174000",
          kind: "log",
          created_at: "2026-02-19T12:00:00Z",
          labels: ["log"],
          metadata: { test: true },
        },
        fetched_by: { kind: "http", request_id: "req-1" },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("parses artifact.attached", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-2",
      type: "artifact.attached",
      occurred_at: "2026-02-19T12:00:00Z",
      scope: { kind: "run", run_id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: {
        artifact: {
          artifact_id: "123e4567-e89b-12d3-a456-426614174000",
          uri: "artifact://123e4567-e89b-12d3-a456-426614174000",
          kind: "log",
          created_at: "2026-02-19T12:00:00Z",
          labels: ["log"],
        },
        step_id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
        attempt_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("parses run.paused", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-3",
      type: "run.paused",
      occurred_at: "2026-02-19T12:00:00Z",
      scope: { kind: "run", run_id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: {
        run_id: "550e8400-e29b-41d4-a716-446655440000",
        reason: "approval",
        approval_id: 7,
        detail: "waiting for approval",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("parses run.queued", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-3a",
      type: "run.queued",
      occurred_at: "2026-02-19T12:00:00Z",
      scope: { kind: "run", run_id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: {
        run_id: "550e8400-e29b-41d4-a716-446655440000",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("parses run.started", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-3b",
      type: "run.started",
      occurred_at: "2026-02-19T12:00:00Z",
      scope: { kind: "run", run_id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: {
        run_id: "550e8400-e29b-41d4-a716-446655440000",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("parses run.completed", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-3c",
      type: "run.completed",
      occurred_at: "2026-02-19T12:00:00Z",
      scope: { kind: "run", run_id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: {
        run_id: "550e8400-e29b-41d4-a716-446655440000",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("parses run.failed", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-3d",
      type: "run.failed",
      occurred_at: "2026-02-19T12:00:00Z",
      scope: { kind: "run", run_id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: {
        run_id: "550e8400-e29b-41d4-a716-446655440000",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("parses run.resumed", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-4",
      type: "run.resumed",
      occurred_at: "2026-02-19T12:00:00Z",
      scope: { kind: "run", run_id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: {
        run_id: "550e8400-e29b-41d4-a716-446655440000",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("parses run.cancelled", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-5",
      type: "run.cancelled",
      occurred_at: "2026-02-19T12:00:00Z",
      scope: { kind: "run", run_id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: {
        run_id: "550e8400-e29b-41d4-a716-446655440000",
        reason: "approval denied",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("parses typing.started/typing.stopped", () => {
    const started = WsEvent.safeParse({
      event_id: "e-6",
      type: "typing.started",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: { session_id: "session-1", lane: "main" },
    });
    expect(started.success).toBe(true);

    const stopped = WsEvent.safeParse({
      event_id: "e-7",
      type: "typing.stopped",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: { session_id: "session-1", lane: "main" },
    });
    expect(stopped.success).toBe(true);
  });

  it("parses message.delta/message.final", () => {
    const delta = WsEvent.safeParse({
      event_id: "e-8",
      type: "message.delta",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        session_id: "session-1",
        lane: "main",
        message_id: "m-1",
        role: "assistant",
        delta: "Hello",
      },
    });
    expect(delta.success).toBe(true);

    const final = WsEvent.safeParse({
      event_id: "e-9",
      type: "message.final",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        session_id: "session-1",
        lane: "main",
        message_id: "m-1",
        role: "assistant",
        content: "Hello world",
      },
    });
    expect(final.success).toBe(true);
  });

  it("parses formatting.fallback", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-10",
      type: "formatting.fallback",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        session_id: "session-1",
        message_id: "m-1",
        reason: "unsupported markdown",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("parses delivery.receipt", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-12",
      type: "delivery.receipt",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        session_id: "session-1",
        lane: "main",
        channel: "telegram",
        thread_id: "thread-1",
        status: "sent",
        receipt: { message_id: "provider-1" },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("parses usage.snapshot", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-13",
      type: "usage.snapshot",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        scope: {
          kind: "run",
          run_id: "550e8400-e29b-41d4-a716-446655440000",
          key: null,
          agent_id: null,
        },
        local: {
          totals: {
            duration_ms: 0,
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            usd_micros: 0,
          },
        },
        provider: null,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("parses provider_usage.polled", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-14",
      type: "provider_usage.polled",
      occurred_at: "2026-02-19T12:00:00Z",
      payload: {
        result: {
          status: "ok",
          provider: "openai",
          profile_id: "profile-1",
          cached: false,
          polled_at: "2026-02-19T12:00:00Z",
          data: { requests: 1 },
        },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("parses context_report.created", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-11",
      type: "context_report.created",
      occurred_at: "2026-02-19T12:00:00Z",
      scope: { kind: "run", run_id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: {
        run_id: "550e8400-e29b-41d4-a716-446655440000",
        report: {
          context_report_id: "11111111-1111-1111-8111-111111111111",
          generated_at: "2026-02-19T12:00:00Z",
          session_id: "session-1",
          channel: "telegram",
          thread_id: "thread-1",
          system_prompt: { chars: 0, sections: [] },
          user_parts: [],
          selected_tools: [],
          tool_schema_top: [],
          tool_schema_total_chars: 0,
          enabled_skills: [],
          mcp_servers: [],
          tool_calls: [],
          injected_files: [],
        },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("parses routing.config.updated", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-routing-1",
      type: "routing.config.updated",
      occurred_at: "2026-02-24T00:00:00Z",
      scope: { kind: "global" },
      payload: {
        revision: 1,
        reason: "seed",
        config_sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("parses auth.failed", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-15",
      type: "auth.failed",
      occurred_at: "2026-02-24T00:00:00Z",
      scope: { kind: "global" },
      payload: {
        surface: "http",
        reason: "invalid_token",
        token_transport: "authorization",
        client_ip: "203.0.113.10",
        method: "GET",
        path: "/api/data",
        user_agent: "vitest",
        request_id: "req-1",
        audit: {
          plan_id: "gateway.auth.audit",
          step_index: 0,
          event_id: 1,
        },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("parses authz.denied", () => {
    const parsed = WsEvent.safeParse({
      event_id: "e-16",
      type: "authz.denied",
      occurred_at: "2026-02-24T00:00:00Z",
      scope: { kind: "global" },
      payload: {
        surface: "http",
        reason: "insufficient_scope",
        token: {
          token_kind: "device",
          token_id: "token-1",
          device_id: "dev_client_1",
          role: "client",
          scopes: ["operator.read"],
          issued_at: "2026-02-24T00:00:00Z",
          expires_at: "2026-02-24T00:10:00Z",
        },
        required_scopes: ["operator.write"],
        method: "POST",
        path: "/memory/facts",
        request_id: "req-2",
        client_ip: "203.0.113.10",
        client_id: "client-1",
        audit: {
          plan_id: "gateway.auth.audit",
          step_index: 1,
          event_id: 2,
        },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects events missing event_id", () => {
    expectRejects(WsEvent, {
      type: "run.queued",
      occurred_at: "2026-02-19T12:00:00Z",
      scope: { kind: "run", run_id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: { run_id: "550e8400-e29b-41d4-a716-446655440000" },
    });
  });

  it("rejects events with non-string occurred_at", () => {
    expectRejects(WsEvent, {
      event_id: "e-bad",
      type: "run.queued",
      occurred_at: 123,
      scope: { kind: "run", run_id: "550e8400-e29b-41d4-a716-446655440000" },
      payload: { run_id: "550e8400-e29b-41d4-a716-446655440000" },
    });
  });
});
