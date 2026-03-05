import type { WsEventEnvelope, WsRequestEnvelope } from "@tyrum/schemas";
import type { ConnectedClient, ConnectionManager } from "../../ws/connection-manager.js";
import type { OutboxDal, OutboxRow } from "./outbox-dal.js";
import type { Logger } from "../observability/logger.js";
import {
  shouldDeliverToWsAudience,
  type WsBroadcastAudience,
  type WsBroadcastRole,
} from "../../ws/audience.js";
import { normalizeScopes } from "../auth/scopes.js";

export interface OutboxPollerOptions {
  consumerId: string;
  outboxDal: OutboxDal;
  connectionManager: ConnectionManager;
  logger?: Logger;
  pollIntervalMs?: number;
  batchSize?: number;
  tenantCacheTtlMs?: number;
}

type WsEnvelope = WsEventEnvelope | WsRequestEnvelope;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isAuthAuditEvent(message: unknown): boolean {
  if (!isObject(message)) return false;
  return message["type"] === "auth.failed" || message["type"] === "authz.denied";
}

function canReceiveAuthAudit(client: ConnectedClient): boolean {
  if (client.role !== "client") return false;
  const claims = client.auth_claims;
  if (!claims) return false;
  const scopes = Array.isArray(claims.scopes) ? claims.scopes : [];
  if (scopes.includes("*")) return true;
  return scopes.some((scope) => typeof scope === "string" && scope.startsWith("operator."));
}

function parseDirectPayload(
  payload: unknown,
): { connection_id: string; message: WsEnvelope } | undefined {
  if (!isObject(payload)) return undefined;
  const connectionId = payload["connection_id"];
  const message = payload["message"];
  if (typeof connectionId !== "string") return undefined;
  if (!isObject(message)) return undefined;
  return { connection_id: connectionId, message: message as WsEnvelope };
}

function parseBroadcastAudience(payload: unknown): WsBroadcastAudience | undefined | null {
  if (!isObject(payload)) return null;

  const hasRolesKey = Object.prototype.hasOwnProperty.call(payload, "roles");
  const hasRequiredScopesKey = Object.prototype.hasOwnProperty.call(payload, "required_scopes");

  let roles: WsBroadcastRole[] | undefined;
  if (hasRolesKey) {
    const rolesRaw = payload["roles"];
    if (!Array.isArray(rolesRaw)) return null;
    if (!rolesRaw.every((role) => role === "client" || role === "node")) return null;
    roles = rolesRaw as WsBroadcastRole[];
  }

  let requiredScopes: string[] | undefined;
  if (hasRequiredScopesKey) {
    const requiredScopesRaw = payload["required_scopes"];
    if (
      !Array.isArray(requiredScopesRaw) ||
      requiredScopesRaw.some((scope) => typeof scope !== "string")
    ) {
      return null;
    }
    requiredScopes = normalizeScopes(requiredScopesRaw as string[]);
  }

  const rolesConstraints = roles && roles.length > 0 ? roles : undefined;
  const scopeConstraints = requiredScopes && requiredScopes.length > 0 ? requiredScopes : undefined;
  if (!rolesConstraints && !scopeConstraints) {
    return undefined;
  }

  return {
    roles: rolesConstraints,
    required_scopes: scopeConstraints,
  };
}

function extractAttemptId(message: WsEnvelope): string | undefined {
  if (message.type !== "task.execute") return undefined;
  const payload = (message as unknown as { payload?: unknown }).payload;
  if (!isObject(payload)) return undefined;
  const attemptId = payload["attempt_id"];
  return typeof attemptId === "string" && attemptId.trim().length > 0 ? attemptId : undefined;
}

function parseBroadcastPayload(payload: unknown):
  | {
      message: WsEnvelope;
      source_edge_id?: string;
      skip_local?: boolean;
      audience?: WsBroadcastAudience;
    }
  | undefined {
  if (!isObject(payload)) return undefined;

  const maybeMessage = payload["message"];
  if (isObject(maybeMessage)) {
    const sourceEdgeId = payload["source_edge_id"];
    const skipLocal = payload["skip_local"];
    const hasAudienceKey = Object.prototype.hasOwnProperty.call(payload, "audience");
    const audience = hasAudienceKey ? parseBroadcastAudience(payload["audience"]) : undefined;
    // Fail closed: malformed audiences must not bypass the delivery filter.
    if (audience === null) return undefined;
    return {
      message: maybeMessage as WsEnvelope,
      source_edge_id: typeof sourceEdgeId === "string" ? sourceEdgeId : undefined,
      skip_local: typeof skipLocal === "boolean" ? skipLocal : undefined,
      audience: audience ?? undefined,
    };
  }
  return undefined;
}

export class OutboxPoller {
  private readonly consumerId: string;
  private readonly outboxDal: OutboxDal;
  private readonly connectionManager: ConnectionManager;
  private readonly logger?: Logger;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly tenantCacheTtlMs: number;
  private cachedTenantIds: { value: string[]; expiresAtMs: number } | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(opts: OutboxPollerOptions) {
    this.consumerId = opts.consumerId;
    this.outboxDal = opts.outboxDal;
    this.connectionManager = opts.connectionManager;
    this.logger = opts.logger;
    this.pollIntervalMs = opts.pollIntervalMs ?? 500;
    this.batchSize = opts.batchSize ?? 200;
    this.tenantCacheTtlMs = Math.max(1_000, Math.min(300_000, opts.tenantCacheTtlMs ?? 10_000));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error("outbox.tick_failed", {
          consumer_id: this.consumerId,
          error: message,
        });
      });
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async listTenantIds(): Promise<string[]> {
    const nowMs = Date.now();
    const cached = this.cachedTenantIds;
    if (cached && cached.expiresAtMs > nowMs) {
      return cached.value;
    }

    const tenantIds = await this.outboxDal.listActiveTenantIds();
    this.cachedTenantIds = { value: tenantIds, expiresAtMs: nowMs + this.tenantCacheTtlMs };
    return tenantIds;
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const tenantIds = await this.listTenantIds();
      if (tenantIds.length === 0) return;

      for (const tenantId of tenantIds) {
        let rows: OutboxRow[];
        try {
          rows = await this.outboxDal.poll(tenantId, this.consumerId, this.batchSize);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger?.error("outbox.poll_failed", {
            consumer_id: this.consumerId,
            tenant_id: tenantId,
            error: message,
          });
          return;
        }
        if (rows.length === 0) continue;

        for (const row of rows) {
          try {
            this.processRow(row);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger?.error("outbox.process_failed", {
              outbox_id: row.id,
              tenant_id: row.tenant_id,
              topic: row.topic,
              error: message,
            });
            // At-least-once semantics: don't ack cursor on failure so the row can be retried.
            return;
          }

          try {
            await this.outboxDal.ackConsumerCursor(row.tenant_id, this.consumerId, row.id);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger?.error("outbox.ack_failed", {
              outbox_id: row.id,
              tenant_id: row.tenant_id,
              topic: row.topic,
              error: message,
            });
            // Cursor is not advanced; retry on next tick.
            return;
          }
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private processRow(row: OutboxRow): void {
    if (row.topic === "ws.broadcast") {
      const parsed = parseBroadcastPayload(row.payload);
      if (!parsed) return;
      if (parsed.skip_local && parsed.source_edge_id === this.consumerId) return;

      const authAudit = isAuthAuditEvent(parsed.message);
      const payload = JSON.stringify(parsed.message);
      for (const client of this.connectionManager.allClients()) {
        if (client.auth_claims?.tenant_id !== row.tenant_id) continue;
        if (authAudit && !canReceiveAuthAudit(client)) continue;
        if (!shouldDeliverToWsAudience(client, parsed.audience)) continue;

        try {
          client.ws.send(payload);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger?.warn("outbox.ws_send_failed", {
            topic: row.topic,
            connection_id: client.id,
            error: message,
          });
        }
      }
      return;
    }

    if (row.topic === "ws.direct") {
      const parsed = parseDirectPayload(row.payload);
      if (!parsed) return;
      const client = this.connectionManager.getClient(parsed.connection_id);
      if (!client) return;
      const clientTenantId = client.auth_claims?.tenant_id ?? null;
      if (clientTenantId !== null && clientTenantId !== row.tenant_id) return;
      try {
        client.ws.send(JSON.stringify(parsed.message));
        if (client.role === "node") {
          const attemptId = extractAttemptId(parsed.message);
          if (attemptId) {
            const nodeId = client.device_id ?? client.id;
            this.connectionManager.recordDispatchedAttemptExecutor(attemptId, nodeId);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.warn("outbox.ws_send_failed", {
          topic: row.topic,
          connection_id: client.id,
          error: message,
        });
      }
      return;
    }
  }
}
