import { describe, expect, it } from "vitest";
import {
  computeEventHash,
  verifyChain,
  type ChainableEvent,
} from "../../src/modules/audit/hash-chain.js";

describe("computeEventHash", () => {
  const baseEvent = {
    plan_id: "plan-1",
    step_index: 0,
    occurred_at: "2025-01-15T10:00:00Z",
    action: '{"type":"Research"}',
  };

  it("is deterministic (same input = same hash)", () => {
    const hash1 = computeEventHash(baseEvent, null);
    const hash2 = computeEventHash(baseEvent, null);
    expect(hash1).toBe(hash2);
  });

  it("produces a 64-character hex string (SHA-256)", () => {
    const hash = computeEventHash(baseEvent, null);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("varies when plan_id changes", () => {
    const hash1 = computeEventHash(baseEvent, null);
    const hash2 = computeEventHash({ ...baseEvent, plan_id: "plan-2" }, null);
    expect(hash1).not.toBe(hash2);
  });

  it("varies when step_index changes", () => {
    const hash1 = computeEventHash(baseEvent, null);
    const hash2 = computeEventHash({ ...baseEvent, step_index: 1 }, null);
    expect(hash1).not.toBe(hash2);
  });

  it("varies when occurred_at changes", () => {
    const hash1 = computeEventHash(baseEvent, null);
    const hash2 = computeEventHash(
      { ...baseEvent, occurred_at: "2025-01-15T11:00:00Z" },
      null,
    );
    expect(hash1).not.toBe(hash2);
  });

  it("varies when action changes", () => {
    const hash1 = computeEventHash(baseEvent, null);
    const hash2 = computeEventHash(
      { ...baseEvent, action: '{"type":"Decide"}' },
      null,
    );
    expect(hash1).not.toBe(hash2);
  });

  it("varies when prevHash changes", () => {
    const hash1 = computeEventHash(baseEvent, null);
    const hash2 = computeEventHash(baseEvent, "abc123");
    expect(hash1).not.toBe(hash2);
  });
});

describe("verifyChain", () => {
  function buildChain(count: number): ChainableEvent[] {
    const events: ChainableEvent[] = [];
    let prevHash: string | null = null;

    for (let i = 0; i < count; i++) {
      const eventData = {
        plan_id: "plan-1",
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

  it("returns valid for a correct chain", () => {
    const events = buildChain(3);
    const result = verifyChain(events);
    expect(result).toEqual({
      valid: true,
      checked_count: 3,
      broken_at_index: null,
      broken_at_id: null,
    });
  });

  it("returns valid for empty chain", () => {
    const result = verifyChain([]);
    expect(result).toEqual({
      valid: true,
      checked_count: 0,
      broken_at_index: null,
      broken_at_id: null,
    });
  });

  it("detects a tampered event_hash", () => {
    const events = buildChain(3);
    events[1]!.event_hash = "tampered_hash_value";
    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    expect(result.broken_at_index).toBe(1);
    expect(result.broken_at_id).toBe(2);
  });

  it("detects a tampered action field", () => {
    const events = buildChain(3);
    events[1]!.action = '{"step":"tampered"}';
    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    expect(result.broken_at_index).toBe(1);
  });

  it("detects broken prev_hash linkage", () => {
    const events = buildChain(3);
    // Recompute event 2 with a wrong prev_hash but set its event_hash correctly
    // so the hash itself is valid but the chain link is broken
    const wrongPrevHash = "wrong_prev_hash";
    const tamperedData = {
      plan_id: events[2]!.plan_id,
      step_index: events[2]!.step_index,
      occurred_at: events[2]!.occurred_at,
      action: events[2]!.action,
    };
    events[2]!.prev_hash = wrongPrevHash;
    events[2]!.event_hash = computeEventHash(tamperedData, wrongPrevHash);

    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    expect(result.broken_at_index).toBe(2);
  });

  it("handles legacy events with null hashes", () => {
    const legacyEvent: ChainableEvent = {
      id: 1,
      plan_id: "plan-1",
      step_index: 0,
      occurred_at: "2025-01-15T10:00:00Z",
      action: '{"step":0}',
      prev_hash: null,
      event_hash: null,
    };

    const result = verifyChain([legacyEvent]);
    expect(result).toEqual({
      valid: true,
      checked_count: 0,
      broken_at_index: null,
      broken_at_id: null,
    });
  });

  it("handles mixed legacy and new events", () => {
    const legacyEvent: ChainableEvent = {
      id: 1,
      plan_id: "plan-1",
      step_index: 0,
      occurred_at: "2025-01-15T10:00:00Z",
      action: '{"step":0}',
      prev_hash: null,
      event_hash: null,
    };

    // New event after legacy; prev_hash is null since legacy has no hash
    const newEventData = {
      plan_id: "plan-1",
      step_index: 1,
      occurred_at: "2025-01-15T10:01:00Z",
      action: '{"step":1}',
    };
    const newEventHash = computeEventHash(newEventData, null);
    const newEvent: ChainableEvent = {
      id: 2,
      ...newEventData,
      prev_hash: null,
      event_hash: newEventHash,
    };

    const result = verifyChain([legacyEvent, newEvent]);
    expect(result).toEqual({
      valid: true,
      checked_count: 1,
      broken_at_index: null,
      broken_at_id: null,
    });
  });
});
