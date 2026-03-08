export function readPayload(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const payload = (data as Record<string, unknown>)["payload"];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

export function readOccurredAt(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = (data as Record<string, unknown>)["occurred_at"];
  return typeof raw === "string" ? raw : null;
}
