import { describe, expect, it, vi } from "vitest";
import { EventConsumer } from "../../src/modules/backplane/event-consumer.js";

describe("EventConsumer", () => {
  it("returns false for first occurrence", () => {
    const consumer = new EventConsumer();
    expect(consumer.isDuplicate("event-1")).toBe(false);
  });

  it("returns true for second occurrence", () => {
    const consumer = new EventConsumer();
    consumer.isDuplicate("event-1");
    expect(consumer.isDuplicate("event-1")).toBe(true);
  });

  it("tracks different event IDs independently", () => {
    const consumer = new EventConsumer();
    expect(consumer.isDuplicate("event-1")).toBe(false);
    expect(consumer.isDuplicate("event-2")).toBe(false);
    expect(consumer.isDuplicate("event-1")).toBe(true);
  });

  it("expires entries after TTL", () => {
    vi.useFakeTimers();
    try {
      const consumer = new EventConsumer({ ttlMs: 1000 });
      consumer.isDuplicate("event-1");

      vi.advanceTimersByTime(1001);

      expect(consumer.isDuplicate("event-1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans up when at max capacity", () => {
    vi.useFakeTimers();
    try {
      const consumer = new EventConsumer({ maxEntries: 3, ttlMs: 1000 });

      consumer.isDuplicate("a");
      consumer.isDuplicate("b");
      vi.advanceTimersByTime(500);
      consumer.isDuplicate("c");

      // Advance past TTL for a and b
      vi.advanceTimersByTime(600);

      // This should trigger cleanup (at max 3, expired a and b)
      consumer.isDuplicate("d");

      expect(consumer.size).toBeLessThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports correct size", () => {
    const consumer = new EventConsumer();
    expect(consumer.size).toBe(0);
    consumer.isDuplicate("a");
    expect(consumer.size).toBe(1);
    consumer.isDuplicate("b");
    expect(consumer.size).toBe(2);
  });
});
