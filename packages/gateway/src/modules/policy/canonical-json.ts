import { createHash } from "node:crypto";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256HexFromString(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (isPlainObject(value)) {
    const sortedKeys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      out[key] = sortValue(value[key]);
    }
    return out;
  }
  return value;
}
