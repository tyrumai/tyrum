import type { Logger } from "./logger.js";
import type { MetricsRegistry } from "./metrics.js";

export type PersistedJsonReason = "invalid_json" | "unexpected_shape" | "invalid_value";
export type PersistedJsonShape = "any" | "array" | "object";

export interface PersistedJsonObserver {
  logger?: Pick<Logger, "warn">;
  metrics?: Pick<MetricsRegistry, "recordPersistedJsonReadFailure">;
}

function matchesShape(value: unknown, shape: PersistedJsonShape): boolean {
  if (shape === "any") return true;
  if (shape === "array") return Array.isArray(value);
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function describeShape(shape: PersistedJsonShape): string {
  if (shape === "any") return "value";
  return shape;
}

export function reportPersistedJsonReadFailure(input: {
  observer?: PersistedJsonObserver;
  table: string;
  column: string;
  reason: PersistedJsonReason;
  error?: string;
  extra?: Record<string, unknown>;
}): void {
  input.observer?.metrics?.recordPersistedJsonReadFailure(input.table, input.column, input.reason);
  input.observer?.logger?.warn("persisted_json.read_failed", {
    table: input.table,
    column: input.column,
    reason: input.reason,
    ...(input.error ? { error: input.error } : {}),
    ...input.extra,
  });
}

export function parsePersistedJson<T>(input: {
  raw: string | null | undefined;
  fallback: T;
  table: string;
  column: string;
  shape: PersistedJsonShape;
  observer?: PersistedJsonObserver;
  validate?: (value: unknown) => value is T;
}): T {
  if (input.raw == null) return input.fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.raw) as unknown;
  } catch (error) {
    reportPersistedJsonReadFailure({
      observer: input.observer,
      table: input.table,
      column: input.column,
      reason: "invalid_json",
      error: error instanceof Error ? error.message : String(error),
    });
    return input.fallback;
  }

  if (!matchesShape(parsed, input.shape)) {
    reportPersistedJsonReadFailure({
      observer: input.observer,
      table: input.table,
      column: input.column,
      reason: "unexpected_shape",
      extra: { expected_shape: input.shape },
    });
    return input.fallback;
  }

  if (input.validate && !input.validate(parsed)) {
    reportPersistedJsonReadFailure({
      observer: input.observer,
      table: input.table,
      column: input.column,
      reason: "invalid_value",
    });
    return input.fallback;
  }

  return parsed as T;
}

export function stringifyPersistedJson<T>(input: {
  value: T;
  table: string;
  column: string;
  shape: PersistedJsonShape;
  validate?: (value: unknown) => value is T;
}): string {
  if (!matchesShape(input.value, input.shape)) {
    throw new Error(`${input.table}.${input.column} must be a JSON ${describeShape(input.shape)}`);
  }

  if (input.validate && !input.validate(input.value)) {
    throw new Error(`${input.table}.${input.column} contains an invalid JSON value`);
  }

  const serialized = JSON.stringify(input.value);
  if (typeof serialized !== "string") {
    throw new Error(`${input.table}.${input.column} could not be serialized as JSON`);
  }

  const reparsed = JSON.parse(serialized) as unknown;
  if (!matchesShape(reparsed, input.shape)) {
    throw new Error(
      `${input.table}.${input.column} must serialize to a JSON ${describeShape(input.shape)}`,
    );
  }

  if (input.validate && !input.validate(reparsed)) {
    throw new Error(`${input.table}.${input.column} contains an invalid JSON value`);
  }
  return serialized;
}
