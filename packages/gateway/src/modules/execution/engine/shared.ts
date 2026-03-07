import type { ClockFn } from "./types.js";
import { safeJsonParse } from "../../../utils/json.js";

export interface ResumeTokenRow {
  tenant_id: string;
  token: string;
  run_id: string;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
}

export interface RunnableRunRow {
  tenant_id: string;
  run_id: string;
  job_id: string;
  agent_id: string;
  key: string;
  lane: string;
  status: "queued" | "running";
  trigger_json: string;
  workspace_id: string;
  policy_snapshot_id: string | null;
}

export interface StepRow {
  tenant_id: string;
  step_id: string;
  run_id: string;
  step_index: number;
  status: string;
  action_json: string;
  created_at: string | Date;
  idempotency_key: string | null;
  postcondition_json: string | null;
  approval_id: string | null;
  max_attempts: number;
  timeout_ms: number;
}

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

export interface RunEventDeps {
  emitRunUpdatedTx(tx: import("../../../statestore/types.js").SqlDb, runId: string): Promise<void>;
  emitStepUpdatedTx(
    tx: import("../../../statestore/types.js").SqlDb,
    stepId: string,
  ): Promise<void>;
  emitAttemptUpdatedTx(
    tx: import("../../../statestore/types.js").SqlDb,
    attemptId: string,
  ): Promise<void>;
}

export interface QueueingDeps extends RunEventDeps {
  db: import("../../../statestore/types.js").SqlDb;
  logger?: import("../../observability/logger.js").Logger;
  emitRunQueuedTx(tx: import("../../../statestore/types.js").SqlDb, runId: string): Promise<void>;
}

export interface RunControlDeps extends RunEventDeps {
  db: import("../../../statestore/types.js").SqlDb;
  clock: ClockFn;
  redactText(text: string): string;
  concurrencyLimits?: import("./types.js").ExecutionConcurrencyLimits;
  emitRunResumedTx(
    tx: import("../../../statestore/types.js").SqlDb,
    runId: string,
  ): Promise<void>;
  emitRunCancelledTx(
    tx: import("../../../statestore/types.js").SqlDb,
    opts: { runId: string; reason?: string },
  ): Promise<void>;
}
