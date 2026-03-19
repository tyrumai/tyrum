import { describe, expect, it, vi } from "vitest";
import { InteractionTracker } from "../src/interaction-tracker.js";

describe("InteractionTracker", () => {
  it("tracks elapsed seconds since the last interaction", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-19T12:00:00Z"));

    const tracker = new InteractionTracker();

    vi.advanceTimersByTime(2_200);
    expect(tracker.lastInputSeconds).toBe(2);

    tracker.recordInteraction();
    vi.advanceTimersByTime(1_100);
    expect(tracker.lastInputSeconds).toBe(1);

    vi.useRealTimers();
  });
});
