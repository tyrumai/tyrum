export function normalizeDbDateTime(value: string | Date): string;
export function normalizeDbDateTime(value: string | Date | null | undefined): string | null;
export function normalizeDbDateTime(value: string | Date | null | undefined): string | null {
  if (value == null) return null;

  const raw = value instanceof Date ? value.toISOString() : value;

  // SQLite `datetime('now')` format: "YYYY-MM-DD HH:MM:SS" (UTC).
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    return `${raw.replace(" ", "T")}Z`;
  }

  return raw;
}
