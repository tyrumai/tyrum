import { randomUUID } from "node:crypto";
import type { ActionPrimitive, Lane as LaneT } from "@tyrum/schemas";
import {
  ActionPrimitive as ActionPrimitiveSchema,
  AgentKey,
  Lane,
  WorkspaceKey,
} from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { sqlActiveWhereClause, sqlBoolParam } from "../../statestore/sql.js";
import type { IdentityScopeDal } from "../identity/scope.js";

export type ScheduleKind = "heartbeat" | "cron";
export type ScheduleDeliveryMode = "quiet" | "notify";

export type ScheduleCadence =
  | {
      type: "interval";
      interval_ms: number;
    }
  | {
      type: "cron";
      expression: string;
      timezone: string;
    };

export type ScheduleExecution =
  | {
      kind: "agent_turn";
      instruction?: string;
    }
  | {
      kind: "playbook";
      playbook_id: string;
    }
  | {
      kind: "steps";
      steps: ActionPrimitive[];
    };

export type StoredScheduleConfig = {
  v: 1;
  schedule_kind: ScheduleKind;
  enabled: boolean;
  cadence: ScheduleCadence;
  execution: ScheduleExecution;
  delivery: {
    mode: ScheduleDeliveryMode;
  };
  seeded_default?: boolean;
  key?: string;
  lane?: LaneT;
};

export type NormalizedScheduleConfig = StoredScheduleConfig & {
  lane: LaneT;
  key?: string;
};

export type ScheduleRecord = {
  schedule_id: string;
  watcher_key: string;
  kind: ScheduleKind;
  enabled: boolean;
  cadence: ScheduleCadence;
  execution: ScheduleExecution;
  delivery: {
    mode: ScheduleDeliveryMode;
  };
  seeded_default: boolean;
  deleted: boolean;
  target_scope: {
    agent_key: string;
    workspace_key: string;
  };
  created_at: string;
  updated_at: string;
  last_fired_at: string | null;
  next_fire_at: string | null;
};

export type CreateScheduleInput = {
  tenantId: string;
  agentKey?: string;
  workspaceKey?: string;
  kind: ScheduleKind;
  enabled?: boolean;
  cadence: ScheduleCadence;
  execution: ScheduleExecution;
  delivery?: {
    mode?: ScheduleDeliveryMode;
  };
  watcherKey?: string;
  seededDefault?: boolean;
  lastFiredAtMs?: number | null;
};

export type UpdateScheduleInput = {
  enabled?: boolean;
  cadence?: ScheduleCadence;
  execution?: ScheduleExecution;
  delivery?: {
    mode?: ScheduleDeliveryMode;
  };
  kind?: ScheduleKind;
};

type RawScheduleRow = {
  tenant_id: string;
  watcher_id: string;
  watcher_key: string;
  agent_id: string;
  agent_key: string;
  workspace_id: string;
  workspace_key: string;
  trigger_type: string;
  trigger_config_json: string;
  active: number | boolean;
  last_fired_at_ms: number | null;
  created_at: string | Date;
  updated_at: string | Date;
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 60_000;
const DEFAULT_HEARTBEAT_INSTRUCTION =
  "Review current work, due signals, blocked items, pending approvals, and recent changes. " +
  "Act only when there is something useful to do or say. If there is nothing useful to surface, return an empty reply.";
const MIN_CRON_FIELD_VALUE = {
  minute: 0,
  hour: 0,
  dayOfMonth: 1,
  month: 1,
  dayOfWeek: 0,
} as const;
const MAX_CRON_FIELD_VALUE = {
  minute: 59,
  hour: 23,
  dayOfMonth: 31,
  month: 12,
  dayOfWeek: 7,
} as const;
const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};
const MAX_CRON_SEARCH_MINUTES = 366 * 24 * 60;

type CronFieldName = "minute" | "hour" | "dayOfMonth" | "month" | "dayOfWeek";
type CronFieldSpec = {
  wildcard: boolean;
  values: Set<number>;
};

type ParsedCronExpression = {
  minute: CronFieldSpec;
  hour: CronFieldSpec;
  dayOfMonth: CronFieldSpec;
  month: CronFieldSpec;
  dayOfWeek: CronFieldSpec;
};

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function isTruthyActive(value: number | boolean): boolean {
  return value === true || value === 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseLane(value: unknown): LaneT | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Lane.safeParse(value.trim().toLowerCase());
  return parsed.success ? parsed.data : undefined;
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

function parseExecution(value: unknown, fallbackKind: ScheduleKind): ScheduleExecution | undefined {
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

  if (fallbackKind === "heartbeat") {
    return { kind: "agent_turn" };
  }
  return undefined;
}

function parseIntervalMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function parseCadence(value: unknown, legacyIntervalMs?: unknown): ScheduleCadence | undefined {
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

  const intervalMs = parseIntervalMs(legacyIntervalMs);
  if (!intervalMs) return undefined;
  return { type: "interval", interval_ms: intervalMs };
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

function defaultStoredLastFiredAtMs(
  config: NormalizedScheduleConfig,
  nowMs: number,
): number | null {
  return config.cadence.type === "cron" ? nowMs : null;
}

function normalizeScheduleConfig(input: {
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
  const lane: LaneT = input.kind === "heartbeat" ? "heartbeat" : "cron";
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
    lane,
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

  const legacyLane = parseLane(parsed["lane"]);
  const kind =
    parseScheduleKind(parsed["schedule_kind"]) ??
    (legacyLane === "heartbeat" ? "heartbeat" : "cron");
  const cadence = parseCadence(parsed["cadence"], parsed["intervalMs"]);
  if (!cadence) return undefined;

  const execution =
    parseExecution(parsed["execution"], kind) ??
    (() => {
      if (Array.isArray(parsed["steps"])) {
        return parseExecution({ kind: "steps", steps: parsed["steps"] }, kind);
      }
      const playbookId =
        typeof parsed["playbook_id"] === "string"
          ? parsed["playbook_id"].trim()
          : typeof parsed["planId"] === "string"
            ? parsed["planId"].trim()
            : "";
      if (playbookId) {
        return parseExecution({ kind: "playbook", playbook_id: playbookId }, kind);
      }
      if (kind === "heartbeat") {
        return { kind: "agent_turn" } as const;
      }
      return undefined;
    })();
  if (!execution) return undefined;

  try {
    return normalizeScheduleConfig({
      kind,
      enabled: parsed["enabled"] === false ? false : true,
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

function buildDefaultHeartbeatWatcherKey(input: { agentId: string; workspaceId: string }): string {
  return `schedule:default-heartbeat:${input.agentId}:${input.workspaceId}`;
}

export function defaultHeartbeatInstruction(): string {
  return DEFAULT_HEARTBEAT_INSTRUCTION;
}

export function defaultHeartbeatCadence(): ScheduleCadence {
  return { type: "interval", interval_ms: DEFAULT_HEARTBEAT_INTERVAL_MS };
}

function formatIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

function coerceWeekday(value: number): number {
  return value === 7 ? 0 : value;
}

function parseCronNumber(field: CronFieldName, token: string): number {
  const raw = token.trim().toLowerCase();
  if (!raw) throw new Error(`invalid cron ${field}: empty token`);
  if (field === "dayOfWeek" && raw in WEEKDAY_INDEX) {
    return WEEKDAY_INDEX[raw]!;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`invalid cron ${field}: '${token}'`);
  }
  const value = Number.parseInt(raw, 10);
  const min = MIN_CRON_FIELD_VALUE[field];
  const max = MAX_CRON_FIELD_VALUE[field];
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`invalid cron ${field}: '${token}' out of range`);
  }
  return field === "dayOfWeek" ? coerceWeekday(value) : value;
}

function addCronRangeValues(
  values: Set<number>,
  field: CronFieldName,
  start: number,
  end: number,
  step: number,
): void {
  if (start > end) {
    throw new Error(`invalid cron ${field}: range start exceeds end`);
  }
  const normalizedStep = Math.max(1, Math.floor(step));
  for (let value = start; value <= end; value += normalizedStep) {
    values.add(field === "dayOfWeek" ? coerceWeekday(value) : value);
  }
}

function parseCronField(field: CronFieldName, rawField: string): CronFieldSpec {
  const trimmed = rawField.trim().toLowerCase();
  if (!trimmed) {
    throw new Error(`invalid cron ${field}: empty field`);
  }
  if (trimmed === "*") {
    const values = new Set<number>();
    addCronRangeValues(values, field, MIN_CRON_FIELD_VALUE[field], MAX_CRON_FIELD_VALUE[field], 1);
    return { wildcard: true, values };
  }

  const values = new Set<number>();
  const parts = trimmed.split(",");
  for (const part of parts) {
    const [rangeToken, stepToken] = part.split("/");
    const token = rangeToken?.trim() ?? "";
    if (!token) {
      throw new Error(`invalid cron ${field}: empty token`);
    }
    const step = stepToken === undefined ? 1 : Number.parseInt(stepToken.trim(), 10);
    if (!Number.isFinite(step) || step <= 0) {
      throw new Error(`invalid cron ${field}: invalid step '${part}'`);
    }

    if (token === "*") {
      addCronRangeValues(
        values,
        field,
        MIN_CRON_FIELD_VALUE[field],
        MAX_CRON_FIELD_VALUE[field],
        step,
      );
      continue;
    }

    const dash = token.indexOf("-");
    if (dash >= 0) {
      const start = parseCronNumber(field, token.slice(0, dash));
      const end = parseCronNumber(field, token.slice(dash + 1));
      addCronRangeValues(values, field, start, end, step);
      continue;
    }

    const value = parseCronNumber(field, token);
    values.add(value);
  }

  return { wildcard: false, values };
}

function parseCronExpression(expression: string): ParsedCronExpression {
  const parts = expression
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (parts.length !== 5) {
    throw new Error("cron expressions must have 5 fields: minute hour day month weekday");
  }
  return {
    minute: parseCronField("minute", parts[0]!),
    hour: parseCronField("hour", parts[1]!),
    dayOfMonth: parseCronField("dayOfMonth", parts[2]!),
    month: parseCronField("month", parts[3]!),
    dayOfWeek: parseCronField("dayOfWeek", parts[4]!),
  };
}

function ensureValidTimeZone(timeZone: string): void {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
    });
    formatter.format(new Date(0));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid timezone '${timeZone}': ${message}`);
  }
}

function resolveCronLocalParts(
  date: Date,
  timeZone: string,
): {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    minute: "2-digit",
    hour: "2-digit",
    day: "2-digit",
    month: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const record = new Map(parts.map((part) => [part.type, part.value]));
  const weekday = record.get("weekday")?.toLowerCase() ?? "";
  const dayOfWeek = WEEKDAY_INDEX[weekday];
  if (dayOfWeek === undefined) {
    throw new Error(`failed to resolve weekday for timezone '${timeZone}'`);
  }
  return {
    minute: Number.parseInt(record.get("minute") ?? "0", 10),
    hour: Number.parseInt(record.get("hour") ?? "0", 10),
    dayOfMonth: Number.parseInt(record.get("day") ?? "1", 10),
    month: Number.parseInt(record.get("month") ?? "1", 10),
    dayOfWeek,
  };
}

function cronMatches(spec: ParsedCronExpression, date: Date, timeZone: string): boolean {
  const local = resolveCronLocalParts(date, timeZone);
  if (!spec.minute.values.has(local.minute)) return false;
  if (!spec.hour.values.has(local.hour)) return false;
  if (!spec.month.values.has(local.month)) return false;

  const dayOfMonthMatch = spec.dayOfMonth.values.has(local.dayOfMonth);
  const dayOfWeekMatch = spec.dayOfWeek.values.has(local.dayOfWeek);

  if (spec.dayOfMonth.wildcard && spec.dayOfWeek.wildcard) return true;
  if (spec.dayOfMonth.wildcard) return dayOfWeekMatch;
  if (spec.dayOfWeek.wildcard) return dayOfMonthMatch;
  return dayOfMonthMatch || dayOfWeekMatch;
}

function ceilToNextMinute(afterMs: number): number {
  const floored = Math.floor(afterMs / 60_000) * 60_000;
  return floored + 60_000;
}

export function nextCronFireAtMs(input: {
  expression: string;
  timeZone: string;
  afterMs: number;
}): number | undefined {
  const spec = parseCronExpression(input.expression);
  ensureValidTimeZone(input.timeZone);
  let candidateMs = ceilToNextMinute(input.afterMs);
  for (let i = 0; i < MAX_CRON_SEARCH_MINUTES; i += 1) {
    const candidate = new Date(candidateMs);
    if (cronMatches(spec, candidate, input.timeZone)) {
      return candidateMs;
    }
    candidateMs += 60_000;
  }
  return undefined;
}

export function resolvePendingScheduleFireMs(input: {
  config: NormalizedScheduleConfig;
  lastFiredAtMs: number | null;
  nowMs: number;
}): number | undefined {
  if (!input.config.enabled) return undefined;

  if (input.config.cadence.type === "interval") {
    const intervalMs = input.config.cadence.interval_ms;
    const slotMs = Math.floor(input.nowMs / intervalMs) * intervalMs;
    const lastFiredAtMs = input.lastFiredAtMs ?? 0;
    return slotMs > lastFiredAtMs ? slotMs : undefined;
  }

  const lastFiredAtMs = input.lastFiredAtMs ?? input.nowMs;
  const next = nextCronFireAtMs({
    expression: input.config.cadence.expression,
    timeZone: input.config.cadence.timezone,
    afterMs: lastFiredAtMs,
  });
  if (next === undefined) return undefined;
  return next <= input.nowMs ? next : undefined;
}

export function resolveNextScheduleFireMs(input: {
  config: NormalizedScheduleConfig;
  lastFiredAtMs: number | null;
  nowMs: number;
}): number | undefined {
  if (!input.config.enabled) return undefined;

  if (input.config.cadence.type === "interval") {
    const intervalMs = input.config.cadence.interval_ms;
    const lastFiredAtMs = input.lastFiredAtMs;
    if (typeof lastFiredAtMs === "number" && Number.isFinite(lastFiredAtMs)) {
      return lastFiredAtMs + intervalMs;
    }
    return Math.floor(input.nowMs / intervalMs) * intervalMs + intervalMs;
  }

  return nextCronFireAtMs({
    expression: input.config.cadence.expression,
    timeZone: input.config.cadence.timezone,
    afterMs: input.lastFiredAtMs ?? input.nowMs,
  });
}

function rowToScheduleRecord(row: RawScheduleRow, nowMs: number): ScheduleRecord | undefined {
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

export class ScheduleService {
  constructor(
    private readonly db: SqlDb,
    private readonly identityScopeDal: IdentityScopeDal,
  ) {}

  private async insertDefaultHeartbeatScheduleForMembership(input: {
    tenantId: string;
    agentId: string;
    workspaceId: string;
    nowMs: number;
  }): Promise<boolean> {
    const cadence = defaultHeartbeatCadence();
    const intervalMs =
      cadence.type === "interval" ? cadence.interval_ms : DEFAULT_HEARTBEAT_INTERVAL_MS;
    const lastFiredAtMs = Math.floor(input.nowMs / intervalMs) * intervalMs;
    const watcherKey = buildDefaultHeartbeatWatcherKey({
      agentId: input.agentId,
      workspaceId: input.workspaceId,
    });
    const scheduleId = randomUUID();
    const config = normalizeScheduleConfig({
      kind: "heartbeat",
      cadence,
      execution: {
        kind: "agent_turn",
        instruction: DEFAULT_HEARTBEAT_INSTRUCTION,
      },
      delivery: { mode: "quiet" },
      seededDefault: true,
    });
    const nowIso = new Date(input.nowMs).toISOString();
    const inserted = await this.db.run(
      `INSERT INTO watchers (
         tenant_id,
         watcher_id,
         watcher_key,
         agent_id,
         workspace_id,
         trigger_type,
         trigger_config_json,
         active,
         last_fired_at_ms,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, 'periodic', ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, watcher_key) DO NOTHING`,
      [
        input.tenantId,
        scheduleId,
        watcherKey,
        input.agentId,
        input.workspaceId,
        serializeScheduleConfig(config),
        sqlBoolParam(this.db, true),
        lastFiredAtMs,
        nowIso,
        nowIso,
      ],
    );
    return inserted.changes > 0;
  }

  async listSchedules(input?: {
    tenantId: string;
    agentKey?: string;
    workspaceKey?: string;
    includeDeleted?: boolean;
  }): Promise<ScheduleRecord[]> {
    const tenantId = input?.tenantId?.trim();
    if (!tenantId) {
      throw new Error("tenantId is required");
    }
    const where = ["w.tenant_id = ?", "w.trigger_type = 'periodic'"];
    const params: unknown[] = [tenantId];
    if (input?.agentKey?.trim()) {
      where.push("ag.agent_key = ?");
      params.push(input.agentKey.trim());
    }
    if (input?.workspaceKey?.trim()) {
      where.push("ws.workspace_key = ?");
      params.push(input.workspaceKey.trim());
    }
    if (!input?.includeDeleted) {
      const activeWhere = sqlActiveWhereClause(this.db);
      where.push(activeWhere.sql.replaceAll("active", "w.active"));
      params.push(...activeWhere.params);
    }

    const rows = await this.db.all<RawScheduleRow>(
      `SELECT
         w.*,
         ag.agent_key,
         ws.workspace_key
       FROM watchers w
       JOIN agents ag
         ON ag.tenant_id = w.tenant_id
        AND ag.agent_id = w.agent_id
       JOIN workspaces ws
         ON ws.tenant_id = w.tenant_id
        AND ws.workspace_id = w.workspace_id
       WHERE ${where.join(" AND ")}
       ORDER BY w.created_at DESC`,
      params,
    );

    const nowMs = Date.now();
    return rows
      .map((row) => rowToScheduleRecord(row, nowMs))
      .filter((row): row is ScheduleRecord => Boolean(row));
  }

  async getSchedule(input: {
    tenantId: string;
    scheduleId: string;
    includeDeleted?: boolean;
  }): Promise<ScheduleRecord | undefined> {
    const tenantId = input.tenantId.trim();
    const scheduleId = input.scheduleId.trim();
    const where = ["w.tenant_id = ?", "w.watcher_id = ?", "w.trigger_type = 'periodic'"];
    const params: unknown[] = [tenantId, scheduleId];
    if (!input.includeDeleted) {
      const activeWhere = sqlActiveWhereClause(this.db);
      where.push(activeWhere.sql.replaceAll("active", "w.active"));
      params.push(...activeWhere.params);
    }

    const row = await this.db.get<RawScheduleRow>(
      `SELECT
         w.*,
         ag.agent_key,
         ws.workspace_key
       FROM watchers w
       JOIN agents ag
         ON ag.tenant_id = w.tenant_id
        AND ag.agent_id = w.agent_id
       JOIN workspaces ws
         ON ws.tenant_id = w.tenant_id
        AND ws.workspace_id = w.workspace_id
       WHERE ${where.join(" AND ")}
       LIMIT 1`,
      params,
    );

    return row ? rowToScheduleRecord(row, Date.now()) : undefined;
  }

  async createSchedule(input: CreateScheduleInput): Promise<ScheduleRecord> {
    const tenantId = input.tenantId.trim();
    const agentKey = input.agentKey?.trim() || "default";
    const workspaceKey = input.workspaceKey?.trim() || "default";
    AgentKey.parse(agentKey);
    WorkspaceKey.parse(workspaceKey);

    const agentId = await this.identityScopeDal.ensureAgentId(tenantId, agentKey);
    const workspaceId = await this.identityScopeDal.ensureWorkspaceId(tenantId, workspaceKey);
    await this.identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);

    const scheduleId = randomUUID();
    const watcherKey = input.watcherKey?.trim() || `schedule:${scheduleId}`;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const config = normalizeScheduleConfig({
      kind: input.kind,
      enabled: input.enabled,
      cadence: input.cadence,
      execution: input.execution,
      delivery: input.delivery,
      seededDefault: input.seededDefault,
    });

    await this.db.run(
      `INSERT INTO watchers (
         tenant_id,
         watcher_id,
         watcher_key,
         agent_id,
         workspace_id,
         trigger_type,
         trigger_config_json,
         active,
         last_fired_at_ms,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, 'periodic', ?, ?, ?, ?, ?)`,
      [
        tenantId,
        scheduleId,
        watcherKey,
        agentId,
        workspaceId,
        serializeScheduleConfig(config),
        sqlBoolParam(this.db, true),
        input.lastFiredAtMs !== undefined
          ? input.lastFiredAtMs
          : defaultStoredLastFiredAtMs(config, nowMs),
        nowIso,
        nowIso,
      ],
    );

    const created = await this.getSchedule({ tenantId, scheduleId });
    if (!created) {
      throw new Error("failed to create schedule");
    }
    return created;
  }

  async updateSchedule(input: {
    tenantId: string;
    scheduleId: string;
    patch: UpdateScheduleInput;
  }): Promise<ScheduleRecord> {
    const existingRow = await this.db.get<{ last_fired_at_ms: number | null }>(
      `SELECT last_fired_at_ms
       FROM watchers
       WHERE tenant_id = ? AND watcher_id = ? AND trigger_type = 'periodic'
       LIMIT 1`,
      [input.tenantId, input.scheduleId],
    );
    const existing = await this.getSchedule({
      tenantId: input.tenantId,
      scheduleId: input.scheduleId,
      includeDeleted: true,
    });
    if (!existing) {
      throw new Error("schedule not found");
    }

    const config = normalizeScheduleConfig({
      kind: input.patch.kind ?? existing.kind,
      enabled: input.patch.enabled ?? existing.enabled,
      cadence: input.patch.cadence ?? existing.cadence,
      execution: input.patch.execution ?? existing.execution,
      delivery: {
        mode: input.patch.delivery?.mode ?? existing.delivery.mode,
      },
      seededDefault: existing.seeded_default,
    });
    const nowMs = Date.now();
    const resetLastFiredAtMs =
      config.enabled &&
      config.cadence.type === "cron" &&
      (!existing.enabled ||
        existing.cadence.type !== "cron" ||
        existingRow?.last_fired_at_ms === null ||
        existingRow?.last_fired_at_ms === undefined);
    const nextLastFiredAtMs = resetLastFiredAtMs ? nowMs : (existingRow?.last_fired_at_ms ?? null);

    await this.db.run(
      `UPDATE watchers
       SET trigger_config_json = ?, last_fired_at_ms = ?, updated_at = ?
       WHERE tenant_id = ? AND watcher_id = ? AND trigger_type = 'periodic'`,
      [
        serializeScheduleConfig(config),
        nextLastFiredAtMs,
        new Date(nowMs).toISOString(),
        input.tenantId,
        input.scheduleId,
      ],
    );

    const updated = await this.getSchedule({
      tenantId: input.tenantId,
      scheduleId: input.scheduleId,
      includeDeleted: true,
    });
    if (!updated) {
      throw new Error("failed to update schedule");
    }
    return updated;
  }

  async pauseSchedule(input: { tenantId: string; scheduleId: string }): Promise<ScheduleRecord> {
    return await this.updateSchedule({
      tenantId: input.tenantId,
      scheduleId: input.scheduleId,
      patch: { enabled: false },
    });
  }

  async resumeSchedule(input: { tenantId: string; scheduleId: string }): Promise<ScheduleRecord> {
    return await this.updateSchedule({
      tenantId: input.tenantId,
      scheduleId: input.scheduleId,
      patch: { enabled: true },
    });
  }

  async deleteSchedule(input: { tenantId: string; scheduleId: string }): Promise<void> {
    await this.db.run(
      `UPDATE watchers
       SET active = ?, updated_at = ?
       WHERE tenant_id = ? AND watcher_id = ? AND trigger_type = 'periodic'`,
      [sqlBoolParam(this.db, false), new Date().toISOString(), input.tenantId, input.scheduleId],
    );
  }

  async ensureDefaultHeartbeatScheduleForMembership(input: {
    tenantId: string;
    agentId: string;
    workspaceId: string;
    nowMs?: number;
  }): Promise<boolean> {
    return await this.insertDefaultHeartbeatScheduleForMembership({
      ...input,
      nowMs: input.nowMs ?? Date.now(),
    });
  }

  async seedDefaultHeartbeatSchedules(nowMs = Date.now()): Promise<number> {
    const memberships = await this.db.all<{
      tenant_id: string;
      agent_id: string;
      workspace_id: string;
    }>(
      `SELECT tenant_id, agent_id, workspace_id
       FROM agent_workspaces
       ORDER BY tenant_id, agent_id, workspace_id`,
    );
    if (memberships.length === 0) return 0;

    let created = 0;

    for (const membership of memberships) {
      if (
        await this.insertDefaultHeartbeatScheduleForMembership({
          tenantId: membership.tenant_id,
          agentId: membership.agent_id,
          workspaceId: membership.workspace_id,
          nowMs,
        })
      ) {
        created += 1;
      }
    }

    return created;
  }
}
