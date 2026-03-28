import type { Logger } from "../../observability/logger.js";
import type { SqlDb } from "../../../statestore/types.js";
import type { ClockFn, ExecutionConcurrencyLimits, ExecutionTurnEventPort } from "./types.js";
import { safeJsonParse } from "../../../utils/json.js";

export type { ResumeTokenRow, RunnableRunRow, StepRow } from "./types.js";

export function normalizeNonnegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  const n = Math.floor(value);
  if (n < 0) return undefined;
  return n;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseTriggerMetadata(triggerJson: string): Record<string, unknown> | undefined {
  const trigger = safeJsonParse(triggerJson, undefined as unknown);
  if (!isRecord(trigger)) return undefined;
  const metadata = trigger["metadata"];
  return isRecord(metadata) ? metadata : undefined;
}

export interface TurnEventDeps extends ExecutionTurnEventPort<SqlDb> {}

export interface QueueingDeps extends TurnEventDeps {
  db: SqlDb;
  logger?: Logger;
  emitTurnQueuedTx(tx: SqlDb, runId: string): Promise<void>;
}

export interface RunControlDeps extends TurnEventDeps {
  db: SqlDb;
  clock: ClockFn;
  redactText(text: string): string;
  concurrencyLimits?: ExecutionConcurrencyLimits;
  emitTurnResumedTx(tx: SqlDb, runId: string): Promise<void>;
  emitTurnCancelledTx(tx: SqlDb, opts: { runId: string; reason?: string }): Promise<void>;
}
