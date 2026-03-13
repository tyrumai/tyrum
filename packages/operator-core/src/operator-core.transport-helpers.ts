export function readClientId(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = (data as Record<string, unknown>)["clientId"];
  if (typeof raw !== "string") return null;
  const clientId = raw.trim();
  return clientId.length > 0 ? clientId : null;
}

export function readDisconnect(data: unknown): { code: number; reason: string } | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const rec = data as Record<string, unknown>;
  const code = rec["code"];
  const reason = rec["reason"];
  if (typeof code !== "number") return null;
  if (typeof reason !== "string") return null;
  return { code, reason };
}

export function readTransportMessage(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = (data as Record<string, unknown>)["message"];
  return typeof raw === "string" ? raw : null;
}

export function readReconnectSchedule(data: unknown): number | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = (data as Record<string, unknown>)["nextRetryAtMs"];
  if (typeof raw !== "number") return null;
  if (!Number.isFinite(raw)) return null;
  return raw;
}
