import type { NormalizedScheduleConfig } from "./schedule-service-types.js";
import { CronExpressionParser } from "cron-parser";

const MAX_CRON_SEARCH_MINUTES = 366 * 24 * 60;
type ParsedCronExpression = ReturnType<typeof CronExpressionParser.parse>;

function normalizeCronExpression(expression: string): string {
  const parts = expression
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (parts.length !== 5) {
    throw new Error("cron expressions must have 5 fields: minute hour day month weekday");
  }
  return parts.join(" ");
}

export function parseCronExpression(expression: string): ParsedCronExpression {
  return CronExpressionParser.parse(normalizeCronExpression(expression));
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

export function resolveIntervalScheduleSlotMs(nowMs: number, intervalMs: number): number {
  return Math.floor(nowMs / intervalMs) * intervalMs;
}

export function nextCronFireAtMs(input: {
  expression: string;
  timeZone: string;
  afterMs: number;
}): number | undefined {
  const expression = normalizeCronExpression(input.expression);
  ensureValidTimeZone(input.timeZone);

  const endDate = new Date(input.afterMs + MAX_CRON_SEARCH_MINUTES * 60_000);
  const iterator = CronExpressionParser.parse(expression, {
    currentDate: new Date(input.afterMs),
    endDate,
    tz: input.timeZone,
  });

  if (!iterator.hasNext()) {
    return undefined;
  }

  return iterator.next().getTime();
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
