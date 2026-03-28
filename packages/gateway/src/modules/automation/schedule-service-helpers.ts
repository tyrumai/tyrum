import type { ActionPrimitive } from "@tyrum/contracts";
import { ActionPrimitive as ActionPrimitiveSchema } from "@tyrum/contracts";
import type {
  NormalizedScheduleConfig,
  RawScheduleRow,
  ScheduleCadence,
  ScheduleDeliveryMode,
  ScheduleExecution,
  ScheduleKind,
  ScheduleRecord,
} from "./schedule-service-types.js";
import {
  ensureValidTimeZone,
  formatIso,
  parseCronExpression,
  resolveIntervalScheduleSlotMs,
  resolveNextScheduleFireMs,
} from "./schedule-service-cron.js";

export {
  ensureValidTimeZone,
  formatIso,
  nextCronFireAtMs,
  parseCronExpression,
  resolveIntervalScheduleSlotMs,
  resolveNextScheduleFireMs,
  resolvePendingScheduleFireMs,
} from "./schedule-service-cron.js";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 60_000;
export const DEFAULT_HEARTBEAT_INSTRUCTION =
  "Review current work, due signals, blocked items, pending approvals, and recent changes. " +
  "Act only when there is something useful to do or say. If there is nothing useful to surface, return an empty reply.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseScheduleKind(value: unknown): ScheduleKind | undefined {
  if (value !== "heartbeat" && value !== "cron") return undefined;
  return value;
}

function normalizeDeliveryMode(
  value: unknown,
  fallback: ScheduleDeliveryMode,
): ScheduleDeliveryMode {
  if (value === "quiet" || value === "notify") {
    return value;
  }
  return fallback;
}

function parseExecution(value: unknown): ScheduleExecution | undefined {
  if (!isRecord(value)) return undefined;
  const kind = value["kind"];
  if (kind === "agent_turn") {
    const instruction =
      typeof value["instruction"] === "string" && value["instruction"].trim().length > 0
        ? value["instruction"].trim()
        : undefined;
    return { kind, ...(instruction ? { instruction } : undefined) };
  }
  if (kind === "playbook") {
    const playbookId = typeof value["playbook_id"] === "string" ? value["playbook_id"].trim() : "";
    if (!playbookId) return undefined;
    return { kind, playbook_id: playbookId };
  }
  if (kind === "steps") {
    const rawSteps = value["steps"];
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) return undefined;
    const steps: ActionPrimitive[] = [];
    for (const rawStep of rawSteps) {
      const parsed = ActionPrimitiveSchema.safeParse(rawStep);
      if (!parsed.success) return undefined;
      steps.push(parsed.data);
    }
    return { kind, steps };
  }
  return undefined;
}

function parseIntervalMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function parseCadence(value: unknown): ScheduleCadence | undefined {
  if (isRecord(value)) {
    if (value["type"] === "interval") {
      const intervalMs = parseIntervalMs(value["interval_ms"]);
      if (!intervalMs) return undefined;
      return { type: "interval", interval_ms: intervalMs };
    }
    if (value["type"] === "cron") {
      const expression = typeof value["expression"] === "string" ? value["expression"].trim() : "";
      const timezone = typeof value["timezone"] === "string" ? value["timezone"].trim() : "";
      if (!expression || !timezone) return undefined;
      parseCronExpression(expression);
      ensureValidTimeZone(timezone);
      return { type: "cron", expression, timezone };
    }
  }
  return undefined;
}

function normalizeExecutionInput(
  execution: ScheduleExecution,
  kind: ScheduleKind,
): ScheduleExecution {
  if (execution.kind === "agent_turn") {
    return {
      kind: "agent_turn",
      instruction:
        execution.instruction?.trim() ||
        (kind === "heartbeat" ? DEFAULT_HEARTBEAT_INSTRUCTION : undefined),
    };
  }

  if (execution.kind === "playbook") {
    const playbookId = execution.playbook_id.trim();
    if (!playbookId) {
      throw new Error("playbook schedules require execution.playbook_id");
    }
    return { kind: "playbook", playbook_id: playbookId };
  }

  if (!Array.isArray(execution.steps) || execution.steps.length === 0) {
    throw new Error("steps schedules require at least one valid action");
  }

  const steps: ActionPrimitive[] = [];
  for (const rawStep of execution.steps) {
    const parsed = ActionPrimitiveSchema.safeParse(rawStep);
    if (!parsed.success) {
      throw new Error(`invalid steps schedule action: ${parsed.error.message}`);
    }
    steps.push(parsed.data);
  }

  return { kind: "steps", steps };
}

export function defaultStoredLastFiredAtMs(
  config: NormalizedScheduleConfig,
  nowMs: number,
): number | null {
  if (config.cadence.type === "cron") {
    return nowMs;
  }
  return resolveIntervalScheduleSlotMs(nowMs, config.cadence.interval_ms);
}

export function normalizeScheduleConfig(input: {
  kind: ScheduleKind;
  enabled?: boolean;
  cadence: ScheduleCadence;
  execution: ScheduleExecution;
  delivery?: { mode?: ScheduleDeliveryMode };
  seededDefault?: boolean;
  key?: string;
}): NormalizedScheduleConfig {
  const enabled = input.enabled ?? true;
  if (input.kind === "heartbeat" && input.execution.kind !== "agent_turn") {
    throw new Error("heartbeat schedules must use execution.kind='agent_turn'");
  }
  if (input.cadence.type === "interval") {
    if (!Number.isFinite(input.cadence.interval_ms) || input.cadence.interval_ms <= 0) {
      throw new Error("interval schedules must use a positive interval_ms");
    }
  } else {
    parseCronExpression(input.cadence.expression);
    ensureValidTimeZone(input.cadence.timezone);
  }
  const deliveryMode = normalizeDeliveryMode(
    input.delivery?.mode,
    input.kind === "heartbeat" ? "quiet" : "notify",
  );
  const normalizedExecution = normalizeExecutionInput(input.execution, input.kind);

  return {
    v: 1,
    schedule_kind: input.kind,
    enabled,
    cadence: input.cadence,
    execution: normalizedExecution,
    delivery: { mode: deliveryMode },
    ...(input.seededDefault ? { seeded_default: true } : undefined),
    ...(input.key?.trim() ? { key: input.key.trim() } : undefined),
  };
}

export function parseScheduleConfig(raw: string): NormalizedScheduleConfig | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    // Intentional: invalid persisted schedule config should be ignored by readers.
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const kind = parseScheduleKind(parsed["schedule_kind"]);
  if (!kind) return undefined;
  const cadence = parseCadence(parsed["cadence"]);
  if (!cadence) return undefined;
  const execution = parseExecution(parsed["execution"]);
  if (!execution) return undefined;

  try {
    return normalizeScheduleConfig({
      kind,
      enabled: parsed["enabled"] !== false,
      cadence,
      execution,
      delivery: {
        mode: isRecord(parsed["delivery"])
          ? (parsed["delivery"]["mode"] as ScheduleDeliveryMode)
          : undefined,
      },
      seededDefault: parsed["seeded_default"] === true,
      key: typeof parsed["key"] === "string" ? parsed["key"] : undefined,
    });
  } catch {
    // Intentional: malformed persisted schedule config should be skipped instead of crashing reads.
    return undefined;
  }
}

export function serializeScheduleConfig(config: NormalizedScheduleConfig): string {
  return JSON.stringify(config);
}

export function defaultHeartbeatInstruction(): string {
  return DEFAULT_HEARTBEAT_INSTRUCTION;
}

export function defaultHeartbeatCadence(): ScheduleCadence {
  return { type: "interval", interval_ms: DEFAULT_HEARTBEAT_INTERVAL_MS };
}

function isTruthyActive(value: number | boolean): boolean {
  return value === true || value === 1;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function rowToScheduleRecord(
  row: RawScheduleRow,
  nowMs: number,
): ScheduleRecord | undefined {
  const config = parseScheduleConfig(row.trigger_config_json);
  if (!config) return undefined;
  const lastFiredAt = row.last_fired_at_ms ?? null;
  const nextFireAtMs = resolveNextScheduleFireMs({
    config,
    lastFiredAtMs: lastFiredAt,
    nowMs,
  });

  return {
    schedule_id: row.watcher_id,
    watcher_key: row.watcher_key,
    kind: config.schedule_kind,
    enabled: config.enabled,
    cadence: config.cadence,
    execution: config.execution,
    delivery: config.delivery,
    seeded_default: config.seeded_default === true,
    deleted: !isTruthyActive(row.active),
    target_scope: {
      agent_key: row.agent_key,
      workspace_key: row.workspace_key,
    },
    created_at: normalizeTime(row.created_at),
    updated_at: normalizeTime(row.updated_at),
    last_fired_at: formatIso(lastFiredAt),
    next_fire_at: formatIso(nextFireAtMs ?? null),
  };
}
