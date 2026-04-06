import type { ExecutionClock } from "./engine/types.js";

export function defaultExecutionClock(): ExecutionClock {
  const now = new Date();
  return { nowMs: now.getTime(), nowIso: now.toISOString() };
}
