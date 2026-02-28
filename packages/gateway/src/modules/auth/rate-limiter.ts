import type { Context, Next } from "hono";
import { getClientIp } from "./client-ip.js";

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterMs: number;
}

export interface SlidingWindowRateLimiterOptions {
  windowMs: number;
  max: number;
  cleanupIntervalMs?: number;
  now?: () => number;
}

export class SlidingWindowRateLimiter {
  readonly #windowMs: number;
  readonly #max: number;
  readonly #now: () => number;
  readonly #entries = new Map<string, number[]>();
  #cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: SlidingWindowRateLimiterOptions) {
    if (!Number.isFinite(opts.windowMs) || opts.windowMs <= 0) {
      throw new Error("SlidingWindowRateLimiter requires a positive windowMs");
    }
    if (!Number.isFinite(opts.max) || opts.max <= 0) {
      throw new Error("SlidingWindowRateLimiter requires a positive max");
    }

    this.#windowMs = opts.windowMs;
    this.#max = opts.max;
    this.#now = opts.now ?? Date.now;

    const cleanupIntervalMs = opts.cleanupIntervalMs ?? 60_000;
    if (cleanupIntervalMs > 0) {
      this.#cleanupTimer = setInterval(() => {
        this.cleanup();
      }, cleanupIntervalMs);
      this.#cleanupTimer.unref();
    }
  }

  stop(): void {
    if (!this.#cleanupTimer) return;
    clearInterval(this.#cleanupTimer);
    this.#cleanupTimer = undefined;
  }

  size(): number {
    return this.#entries.size;
  }

  cleanup(): void {
    const nowMs = this.#now();
    const cutoffMs = nowMs - this.#windowMs;

    for (const [key, samples] of this.#entries) {
      while (samples.length > 0 && samples[0]! <= cutoffMs) {
        samples.shift();
      }

      if (samples.length === 0) {
        this.#entries.delete(key);
      }
    }
  }

  check(key: string): RateLimitCheckResult {
    const nowMs = this.#now();
    const cutoffMs = nowMs - this.#windowMs;
    const samples = this.#entries.get(key) ?? [];

    while (samples.length > 0 && samples[0]! <= cutoffMs) {
      samples.shift();
    }

    if (samples.length >= this.#max) {
      const oldestMs = samples[0] ?? nowMs;
      const retryAfterMs = Math.max(0, oldestMs + this.#windowMs - nowMs);
      this.#entries.set(key, samples);
      return { allowed: false, retryAfterMs };
    }

    samples.push(nowMs);
    this.#entries.set(key, samples);
    return { allowed: true, retryAfterMs: 0 };
  }
}

export function createRateLimitMiddleware(
  limiter: SlidingWindowRateLimiter,
  opts?: {
    prefix?: string;
  },
): (c: Context, next: Next) => Promise<void | Response> {
  const prefix = opts?.prefix?.trim() ?? "";

  return async (c, next) => {
    const clientIp = getClientIp(c);
    if (!clientIp) {
      return await next();
    }

    const key = prefix ? `${prefix}:${clientIp}` : clientIp;
    const result = limiter.check(key);
    if (result.allowed) {
      return await next();
    }

    const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    c.header("Retry-After", String(retryAfterSeconds));
    return c.json(
      {
        error: "too_many_requests",
        message: "Too many requests",
      },
      429,
    );
  };
}
