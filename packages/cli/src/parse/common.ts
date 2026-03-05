export function parseNonEmptyString(raw: string | undefined, flag: string): string {
  if (!raw) throw new Error(`${flag} requires a value`);
  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${flag} requires a non-empty value`);
  return trimmed;
}

export function parseRequiredValue(raw: string | undefined, flag: string): string {
  if (!raw) throw new Error(`${flag} requires a value`);
  return raw;
}

export function parsePositiveInt(raw: string | undefined, flag: string): number {
  if (!raw) throw new Error(`${flag} requires a value`);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseJsonObject(raw: string | undefined, flag: string): Record<string, unknown> {
  if (!raw) throw new Error(`${flag} requires a value`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${flag} must be valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${flag} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export function parseJsonArray(raw: string | undefined, flag: string): unknown[] {
  if (!raw) throw new Error(`${flag} requires a value`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${flag} must be valid JSON`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${flag} must be a JSON array`);
  }
  if (parsed.length === 0) {
    throw new Error(`${flag} must be a non-empty JSON array`);
  }
  return parsed;
}

export function parseElevatedToken(raw: string | undefined): string {
  return parseNonEmptyString(raw, "--elevated-token");
}
