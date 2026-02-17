import { describe, expect, it } from "vitest";
import {
  computeEventHash,
  exportReceiptBundle,
  type ChainableEvent,
} from "../../src/modules/audit/hash-chain.js";

describe("exportReceiptBundle", () => {
  function buildChain(planId: string, count: number): ChainableEvent[] {
    const events: ChainableEvent[] = [];
    let prevHash: string | null = null;

    for (let i = 0; i < count; i++) {
      const eventData = {
        plan_id: planId,
        step_index: i,
        occurred_at: `2025-01-15T10:0${String(i)}:00Z`,
        action: `{"step":${String(i)}}`,
      };
      const eventHash = computeEventHash(eventData, prevHash);
      events.push({
        id: i + 1,
        ...eventData,
        prev_hash: prevHash,
        event_hash: eventHash,
      });
      prevHash = eventHash;
    }

    return events;
  }

  it("builds a valid receipt bundle", () => {
    const events = buildChain("plan-1", 3);
    const bundle = exportReceiptBundle("plan-1", events);

    expect(bundle.plan_id).toBe("plan-1");
    expect(bundle.events).toHaveLength(3);
    expect(bundle.chain_verification.valid).toBe(true);
    expect(bundle.chain_verification.checked_count).toBe(3);
    expect(bundle.exported_at).toBeDefined();
  });

  it("detects tampered events in the bundle", () => {
    const events = buildChain("plan-1", 3);
    events[1]!.action = '{"tampered":true}';

    const bundle = exportReceiptBundle("plan-1", events);

    expect(bundle.chain_verification.valid).toBe(false);
    expect(bundle.chain_verification.broken_at_index).toBe(1);
  });

  it("maps all event fields correctly", () => {
    const events = buildChain("plan-1", 1);
    const bundle = exportReceiptBundle("plan-1", events);

    const e = bundle.events[0]!;
    expect(e.id).toBe(1);
    expect(e.plan_id).toBe("plan-1");
    expect(e.step_index).toBe(0);
    expect(e.occurred_at).toBe("2025-01-15T10:00:00Z");
    expect(e.action).toBe('{"step":0}');
    expect(e.prev_hash).toBeNull();
    expect(e.event_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles empty events array", () => {
    const bundle = exportReceiptBundle("plan-1", []);

    expect(bundle.events).toHaveLength(0);
    expect(bundle.chain_verification.valid).toBe(true);
    expect(bundle.chain_verification.checked_count).toBe(0);
  });
});
