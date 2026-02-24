import { randomUUID } from "node:crypto";
import type { WsEventEnvelope } from "@tyrum/schemas";
import type { Logger } from "../observability/logger.js";
import type { EventLog } from "../planner/event-log.js";
import { enqueueWsBroadcastMessage } from "../../ws/outbox.js";

export const GATEWAY_AUTH_AUDIT_PLAN_ID = "gateway.auth.audit";

type TokenTransport = "authorization" | "cookie" | "query" | "subprotocol" | "missing";

class FixedWindowRateLimiter {
  private readonly nextAllowedAtByKey = new Map<string, number>();

  constructor(
    private readonly windowMs: number,
    private readonly nowMs: () => number,
  ) {}

  allow(key: string): boolean {
    const now = this.nowMs();
    const nextAllowedAt = this.nextAllowedAtByKey.get(key) ?? 0;
    if (now < nextAllowedAt) return false;
    this.nextAllowedAtByKey.set(key, now + this.windowMs);
    return true;
  }
}

export class AuthAudit {
  private readonly eventLog: EventLog;
  private readonly logger?: Logger;
  private readonly failedAuthLimiter: FixedWindowRateLimiter;
  private readonly nowMs: () => number;

  constructor(opts: {
    eventLog: EventLog;
    logger?: Logger;
    nowMs?: () => number;
    failedAuthWindowMs?: number;
  }) {
    this.eventLog = opts.eventLog;
    this.logger = opts.logger;
    this.nowMs = opts.nowMs ?? Date.now;
    this.failedAuthLimiter = new FixedWindowRateLimiter(
      Math.max(1, opts.failedAuthWindowMs ?? 10_000),
      this.nowMs,
    );
  }

  async recordAuthFailed(params: {
    surface: "http" | "ws.upgrade";
    reason: "missing_token" | "invalid_token" | "unauthorized";
    token_transport: TokenTransport;
    client_ip?: string;
    method?: string;
    path?: string;
    user_agent?: string;
    request_id?: string;
  }): Promise<void> {
    const limiterKey = `${params.surface}:${params.client_ip ?? "unknown"}`;
    if (!this.failedAuthLimiter.allow(limiterKey)) return;

    const occurredAt = new Date(this.nowMs()).toISOString();
    const action = {
      type: "auth.failed",
      surface: params.surface,
      reason: params.reason,
      token_transport: params.token_transport,
      client_ip: params.client_ip,
      method: params.method,
      path: params.path,
      user_agent: params.user_agent,
      request_id: params.request_id,
    };

    try {
      await this.eventLog.appendNext(
        {
          replayId: randomUUID(),
          planId: GATEWAY_AUTH_AUDIT_PLAN_ID,
          occurredAt,
          action,
        },
        async (tx, auditEvent) => {
          const evt: WsEventEnvelope = {
            event_id: randomUUID(),
            type: "auth.failed",
            occurred_at: occurredAt,
            scope: { kind: "global" },
            payload: {
              surface: params.surface,
              reason: params.reason,
              token_transport: params.token_transport,
              client_ip: params.client_ip,
              method: params.method,
              path: params.path,
              user_agent: params.user_agent,
              request_id: params.request_id,
              audit: {
                plan_id: GATEWAY_AUTH_AUDIT_PLAN_ID,
                step_index: auditEvent.stepIndex,
                event_id: auditEvent.id,
              },
            },
          };

          await enqueueWsBroadcastMessage(tx, evt);
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn("auth.audit_failed", {
        error: message,
        surface: params.surface,
        reason: params.reason,
        token_transport: params.token_transport,
      });
    }
  }

  async recordAuthzDenied(params: {
    surface: "http" | "ws";
    reason: "insufficient_scope" | "not_scope_authorized";
    token: {
      token_kind: "admin" | "device";
      token_id?: string;
      device_id?: string;
      role: "admin" | "client" | "node";
      scopes: string[];
    };
    required_scopes: string[] | null;
    method?: string;
    path?: string;
    request_type?: string;
    request_id?: string;
    client_ip?: string;
    client_id?: string;
  }): Promise<void> {
    const occurredAt = new Date(this.nowMs()).toISOString();
    const action = {
      type: "authz.denied",
      surface: params.surface,
      reason: params.reason,
      token: params.token,
      required_scopes: params.required_scopes,
      method: params.method,
      path: params.path,
      request_type: params.request_type,
      request_id: params.request_id,
      client_ip: params.client_ip,
      client_id: params.client_id,
    };

    try {
      await this.eventLog.appendNext(
        {
          replayId: randomUUID(),
          planId: GATEWAY_AUTH_AUDIT_PLAN_ID,
          occurredAt,
          action,
        },
        async (tx, auditEvent) => {
          const evt: WsEventEnvelope = {
            event_id: randomUUID(),
            type: "authz.denied",
            occurred_at: occurredAt,
            scope: { kind: "global" },
            payload: {
              surface: params.surface,
              reason: params.reason,
              token: params.token,
              required_scopes: params.required_scopes,
              method: params.method,
              path: params.path,
              request_type: params.request_type,
              request_id: params.request_id,
              client_ip: params.client_ip,
              client_id: params.client_id,
              audit: {
                plan_id: GATEWAY_AUTH_AUDIT_PLAN_ID,
                step_index: auditEvent.stepIndex,
                event_id: auditEvent.id,
              },
            },
          };
          await enqueueWsBroadcastMessage(tx, evt);
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn("authz.audit_failed", { error: message });
    }
  }
}

