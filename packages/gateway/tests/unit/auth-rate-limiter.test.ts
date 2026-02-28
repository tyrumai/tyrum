import { afterEach, describe, expect, it, vi } from "vitest";
import { SlidingWindowRateLimiter } from "../../src/modules/auth/rate-limiter.js";

describe("SlidingWindowRateLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks after reaching the max and returns retryAfterMs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-28T00:00:00.000Z"));

    const limiter = new SlidingWindowRateLimiter({
      windowMs: 60_000,
      max: 2,
      cleanupIntervalMs: 0,
    });

    expect(limiter.check("ip:127.0.0.1")).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(limiter.check("ip:127.0.0.1")).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(limiter.check("ip:127.0.0.1")).toEqual({ allowed: false, retryAfterMs: 60_000 });
  });

  it("allows requests again once the window expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-28T00:00:00.000Z"));

    const limiter = new SlidingWindowRateLimiter({
      windowMs: 1_000,
      max: 1,
      cleanupIntervalMs: 0,
    });

    expect(limiter.check("k")).toEqual({ allowed: true, retryAfterMs: 0 });
    expect(limiter.check("k").allowed).toBe(false);

    vi.setSystemTime(new Date("2026-02-28T00:00:01.001Z"));
    expect(limiter.check("k")).toEqual({ allowed: true, retryAfterMs: 0 });
  });

  it("purges stale keys during cleanup", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-28T00:00:00.000Z"));

    const limiter = new SlidingWindowRateLimiter({
      windowMs: 1_000,
      max: 1,
      cleanupIntervalMs: 0,
    });

    limiter.check("a");
    limiter.check("b");
    expect(limiter.size()).toBe(2);

    vi.setSystemTime(new Date("2026-02-28T00:00:02.000Z"));
    limiter.cleanup();
    expect(limiter.size()).toBe(0);
  });
});
