import type { ExecutionClock } from "./types.js";

export function defaultClock(): ExecutionClock {
  const now = new Date();
  return { nowMs: now.getTime(), nowIso: now.toISOString() };
}
