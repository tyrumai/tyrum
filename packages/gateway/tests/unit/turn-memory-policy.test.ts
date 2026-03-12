import { describe, expect, it } from "vitest";
import {
  buildTurnMemoryDedupeKey,
  buildTurnMemoryProtocolPrompt,
  createTurnMemoryDecisionCollector,
  recordTurnMemoryDecision,
  resolveTurnMemoryOrigin,
} from "../../src/modules/agent/runtime/turn-memory-policy.js";

describe("turn memory policy helpers", () => {
  it("records a valid false decision", () => {
    const collector = createTurnMemoryDecisionCollector();
    const result = recordTurnMemoryDecision(collector, {
      should_store: false,
      reason: "No durable information.",
    });

    expect(result).toEqual({ ok: true });
    expect(collector.calls).toBe(1);
    expect(collector.invalidCalls).toBe(0);
    expect(collector.lastDecision).toEqual({
      should_store: false,
      reason: "No durable information.",
    });
  });

  it("records the last valid decision and tracks invalid calls", () => {
    const collector = createTurnMemoryDecisionCollector();

    const invalid = recordTurnMemoryDecision(collector, {
      should_store: true,
      reason: "missing payload",
    });
    const valid = recordTurnMemoryDecision(collector, {
      should_store: true,
      reason: "Contains a durable preference.",
      memory: {
        kind: "note",
        body_md: "User prefers terse answers.",
      },
    });

    expect(invalid.ok).toBe(false);
    expect(valid).toEqual({ ok: true });
    expect(collector.calls).toBe(2);
    expect(collector.invalidCalls).toBe(1);
    expect(collector.lastDecision).toEqual({
      should_store: true,
      reason: "Contains a durable preference.",
      memory: {
        kind: "note",
        body_md: "User prefers terse answers.",
      },
    });
  });

  it("resolves automation origins from metadata", () => {
    expect(resolveTurnMemoryOrigin(undefined)).toBe("interaction");
    expect(
      resolveTurnMemoryOrigin({
        automation: { schedule_kind: "heartbeat", delivery_mode: "quiet" },
      }),
    ).toBe("automation_quiet");
    expect(
      resolveTurnMemoryOrigin({
        automation: { schedule_kind: "cron", delivery_mode: "notify" },
      }),
    ).toBe("automation_notify");
  });

  it("builds stable dedupe keys for identical decisions", () => {
    const left = buildTurnMemoryDedupeKey(
      {
        should_store: true,
        reason: "Durable name preference.",
        memory: {
          kind: "fact",
          key: "user.name",
          value: { name: "Ron" },
        },
      },
      "interaction",
    );
    const right = buildTurnMemoryDedupeKey(
      {
        should_store: true,
        reason: "Durable name preference.",
        memory: {
          kind: "fact",
          key: "user.name",
          value: { name: "Ron" },
        },
      },
      "interaction",
    );

    expect(left).toBe(right);
  });

  it("mentions automation no-op guidance in the protocol prompt", () => {
    const prompt = buildTurnMemoryProtocolPrompt({
      schedule_kind: "heartbeat",
      delivery_mode: "quiet",
    });
    expect(prompt).toContain("memory_turn_decision");
    expect(prompt).toContain("should_store=false");
    expect(prompt).toContain("automation-origin turn");
  });
});
