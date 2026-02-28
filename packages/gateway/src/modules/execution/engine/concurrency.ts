import type { ClientCapability as ClientCapabilityT } from "@tyrum/schemas";
import type { Logger } from "../../observability/logger.js";
import type { ExecutionConcurrencyLimits } from "./types.js";

function normalizeNonnegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  const n = Math.floor(value);
  if (n < 0) return undefined;
  return n;
}

function normalizePositiveInt(value: unknown): number | undefined {
  const n = normalizeNonnegativeInt(value);
  if (n === undefined) return undefined;
  if (n <= 0) return undefined;
  return n;
}

const KNOWN_CAPABILITIES = new Set<string>(["playwright", "android", "desktop", "cli", "http"]);
const NORMALIZERS = { normalizeNonnegativeInt, normalizePositiveInt };

export function parseConcurrencyLimitsFromEnv(
  logger?: Logger,
): ExecutionConcurrencyLimits | undefined {
  const raw = process.env["TYRUM_EXEC_CONCURRENCY_LIMITS"]?.trim();
  if (!raw) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger?.warn("execution.concurrency_limits_invalid", {
      reason: "invalid_json",
      error: message,
    });
    return undefined;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    logger?.warn("execution.concurrency_limits_invalid", { reason: "not_object" });
    return undefined;
  }

  const obj = parsed as Record<string, unknown>;
  const global = NORMALIZERS.normalizeNonnegativeInt(obj["global"]);
  const perAgent = NORMALIZERS.normalizeNonnegativeInt(obj["per_agent"] ?? obj["perAgent"]);

  let perCapability: Partial<Record<ClientCapabilityT, number>> | undefined;
  const rawCaps = obj["per_capability"] ?? obj["perCapability"];
  if (rawCaps && typeof rawCaps === "object" && !Array.isArray(rawCaps)) {
    const out: Partial<Record<ClientCapabilityT, number>> = {};
    for (const [key, value] of Object.entries(rawCaps as Record<string, unknown>)) {
      if (!KNOWN_CAPABILITIES.has(key)) continue;
      const limit = NORMALIZERS.normalizeNonnegativeInt(value);
      if (limit === undefined) continue;
      out[key as ClientCapabilityT] = limit;
    }
    if (Object.keys(out).length > 0) {
      perCapability = out;
    }
  }

  if (global === undefined && perAgent === undefined && perCapability === undefined) {
    logger?.warn("execution.concurrency_limits_invalid", { reason: "no_limits" });
    return undefined;
  }

  return { global, perAgent, perCapability };
}
