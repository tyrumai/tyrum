export function coerceRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function coerceString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function coerceStringRecord(value: unknown): Record<string, string> | undefined {
  const record = coerceRecord(value);
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(record)) {
    if (typeof v === "string") out[key] = v;
  }
  return out;
}

export function coerceNonEmptyStringRecord(value: unknown): Record<string, string> | undefined {
  const record = coerceRecord(value);
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(record)) {
    const k = coerceString(key);
    const vv = coerceString(v);
    if (k && vv) out[k] = vv;
  }
  return out;
}
