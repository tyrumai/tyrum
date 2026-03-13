import { ApprovalKind, type Approval } from "@tyrum/schemas";
import type { WsApprovalRequest } from "@tyrum/client/browser";
import { readOccurredAt, readPayload } from "./operator-core.event-helpers.js";

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

export function readPendingApprovalFromRequest(data: unknown): Approval | null {
  const payload = readPayload(data);
  if (!payload) return null;
  const approvalId =
    typeof payload["approval_id"] === "string" ? payload["approval_id"].trim() : "";
  const approvalKey =
    typeof payload["approval_key"] === "string" ? payload["approval_key"].trim() : "";
  const kind = typeof payload["kind"] === "string" ? payload["kind"].trim() : "";
  const prompt = typeof payload["prompt"] === "string" ? payload["prompt"] : "";
  const occurredAt = readOccurredAt(data) ?? new Date().toISOString();
  const parsedKind = ApprovalKind.safeParse(kind);

  if (!approvalId || !approvalKey || !kind || !prompt) return null;

  return {
    approval_id: approvalId,
    approval_key: approvalKey,
    kind: parsedKind.success ? parsedKind.data : "other",
    status: "pending",
    prompt,
    context: payload["context"],
    created_at: occurredAt,
    expires_at:
      typeof payload["expires_at"] === "string" || payload["expires_at"] === null
        ? (payload["expires_at"] as WsApprovalRequest["payload"]["expires_at"])
        : null,
    resolution: null,
  };
}
