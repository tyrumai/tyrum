import type { NormalizedScheduleConfig } from "./schedule-service-types.js";

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

export function parseCronExpression(expression: string): ParsedCronExpression {
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

export function ensureValidTimeZone(timeZone: string): void {
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

export function resolveIntervalScheduleSlotMs(nowMs: number, intervalMs: number): number {
  return Math.floor(nowMs / intervalMs) * intervalMs;
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
    const slotMs = resolveIntervalScheduleSlotMs(input.nowMs, intervalMs);
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
    const pendingFireAtMs = resolvePendingScheduleFireMs(input);
    if (pendingFireAtMs !== undefined) {
      return pendingFireAtMs;
    }
    return resolveIntervalScheduleSlotMs(input.nowMs, intervalMs) + intervalMs;
  }

  return nextCronFireAtMs({
    expression: input.config.cadence.expression,
    timeZone: input.config.cadence.timezone,
    afterMs: input.lastFiredAtMs ?? input.nowMs,
  });
}

export function formatIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}
