import { describe, expect, it } from "vitest";
import {
  GatewayEventEnvelope,
  RunLifecyclePayload,
  StepLifecyclePayload,
  ApprovalLifecyclePayload,
  WatcherFiredPayload,
} from "../src/index.js";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const NOW = "2026-02-20T10:00:00Z";

describe("GatewayEventEnvelope", () => {
  it("parses a valid envelope", () => {
    const env = GatewayEventEnvelope.parse({
      event_id: UUID,
      kind: "run.started",
      occurred_at: NOW,
      payload: { run_id: UUID },
    });
    expect(env.kind).toBe("run.started");
  });

  it("rejects invalid kind", () => {
    expect(() =>
      GatewayEventEnvelope.parse({
        event_id: UUID,
        kind: "invalid.kind",
        occurred_at: NOW,
        payload: {},
      }),
    ).toThrow();
  });

  it("rejects non-uuid event_id", () => {
    expect(() =>
      GatewayEventEnvelope.parse({
        event_id: "not-a-uuid",
        kind: "run.queued",
        occurred_at: NOW,
        payload: {},
      }),
    ).toThrow();
  });

  it("rejects extra fields (strict)", () => {
    expect(() =>
      GatewayEventEnvelope.parse({
        event_id: UUID,
        kind: "run.queued",
        occurred_at: NOW,
        payload: {},
        extra: true,
      }),
    ).toThrow();
  });
});

describe("RunLifecyclePayload", () => {
  it("parses valid payload", () => {
    const p = RunLifecyclePayload.parse({
      run_id: UUID,
      status: "running",
    });
    expect(p.status).toBe("running");
  });

  it("accepts optional detail", () => {
    const p = RunLifecyclePayload.parse({
      run_id: UUID,
      status: "failed",
      detail: "timeout",
    });
    expect(p.detail).toBe("timeout");
  });

  it("rejects missing run_id", () => {
    expect(() => RunLifecyclePayload.parse({ status: "running" })).toThrow();
  });
});

describe("StepLifecyclePayload", () => {
  it("parses valid payload", () => {
    const p = StepLifecyclePayload.parse({
      run_id: UUID,
      step_id: UUID,
      step_index: 0,
      status: "running",
    });
    expect(p.step_index).toBe(0);
  });

  it("rejects negative step_index", () => {
    expect(() =>
      StepLifecyclePayload.parse({
        run_id: UUID,
        step_id: UUID,
        step_index: -1,
        status: "running",
      }),
    ).toThrow();
  });
});

describe("ApprovalLifecyclePayload", () => {
  it("parses valid payload", () => {
    const p = ApprovalLifecyclePayload.parse({
      approval_id: 1,
      status: "requested",
    });
    expect(p.status).toBe("requested");
  });

  it("accepts optional decision", () => {
    const p = ApprovalLifecyclePayload.parse({
      approval_id: 2,
      status: "resolved",
      decision: "approved",
    });
    expect(p.decision).toBe("approved");
  });

  it("rejects zero approval_id", () => {
    expect(() =>
      ApprovalLifecyclePayload.parse({
        approval_id: 0,
        status: "requested",
      }),
    ).toThrow();
  });
});

describe("WatcherFiredPayload", () => {
  it("parses valid payload", () => {
    const p = WatcherFiredPayload.parse({
      watcher_id: 42,
      trigger_type: "cron",
    });
    expect(p.watcher_id).toBe(42);
    expect(p.trigger_type).toBe("cron");
  });

  it("rejects missing trigger_type", () => {
    expect(() => WatcherFiredPayload.parse({ watcher_id: 1 })).toThrow();
  });

  it("rejects extra fields (strict)", () => {
    expect(() =>
      WatcherFiredPayload.parse({
        watcher_id: 1,
        trigger_type: "manual",
        extra: true,
      }),
    ).toThrow();
  });
});
