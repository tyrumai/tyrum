/**
 * Policy bundle + override routes — operator surfaces.
 *
 * These endpoints are additive and do not replace the existing `/policy/check`
 * rule-engine endpoint (spend/pii/legal guardrails).
 */

import {
  PolicyOverrideCreateRequest,
  PolicyOverrideCreateResponse,
  PolicyOverrideListRequest,
  PolicyOverrideListResponse,
  PolicyOverrideRevokeRequest,
  PolicyOverrideRevokeResponse,
  type WsEventEnvelope,
} from "@tyrum/contracts";
import { PolicyAdminService, type PolicyService } from "@tyrum/runtime-policy";
import { Hono } from "hono";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { OutboxDal } from "../app/modules/backplane/outbox-dal.js";
import type { Logger } from "../app/modules/observability/logger.js";
import type { PolicyOverrideDal } from "../app/modules/policy/override-dal.js";
import type { WsEventDal } from "../app/modules/ws-event/dal.js";
import { getClientIp } from "../app/modules/auth/client-ip.js";
import { requireTenantId } from "../app/modules/auth/claims.js";
import { POLICY_WS_AUDIENCE, type WsBroadcastAudience } from "../ws/audience.js";
import { broadcastWsEvent } from "../ws/broadcast.js";
import { ensurePolicyOverrideCreatedEvent } from "../ws/stable-events.js";

export interface PolicyBundleRouteDeps {
  logger?: Logger;
  policyService: PolicyService;
  policyOverrideDal: PolicyOverrideDal;
  wsEventDal?: WsEventDal;
  ws?: {
    connectionManager: ConnectionManager;
    maxBufferedBytes?: number;
    cluster?: {
      edgeId: string;
      outboxDal: OutboxDal;
    };
  };
}

function emitEvent(
  deps: PolicyBundleRouteDeps,
  tenantId: string,
  evt: WsEventEnvelope,
  audience?: WsBroadcastAudience,
): void {
  const ws = deps.ws;
  if (!ws) return;
  broadcastWsEvent(tenantId, evt, { ...ws, logger: deps.logger }, audience ?? POLICY_WS_AUDIENCE);
}

export function createPolicyBundleRoutes(deps: PolicyBundleRouteDeps): Hono {
  const app = new Hono();
  const policyAdmin = new PolicyAdminService({
    policyOverrideStore: deps.policyOverrideDal,
  });

  app.get("/policy/bundle", async (c) => {
    const tenantId = requireTenantId(c);
    const effective = await deps.policyService.loadEffectiveBundle({ tenantId });
    return c.json({
      status: "ok",
      generated_at: new Date().toISOString(),
      effective: {
        sha256: effective.sha256,
        bundle: effective.bundle,
        sources: effective.sources,
      },
    });
  });

  app.get("/policy/overrides", async (c) => {
    const tenantId = requireTenantId(c);
    const raw = {
      agent_id: c.req.query("agent_id")?.trim() || undefined,
      tool_id: c.req.query("tool_id")?.trim() || undefined,
      status: c.req.query("status")?.trim() || undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
      cursor: c.req.query("cursor")?.trim() || undefined,
    };
    const parsed = PolicyOverrideListRequest.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const rows = await policyAdmin.listOverrides({
      tenantId,
      agentId: parsed.data.agent_id,
      toolId: parsed.data.tool_id,
      status: parsed.data.status,
      limit: parsed.data.limit,
    });
    const res = PolicyOverrideListResponse.parse({ overrides: rows, next_cursor: undefined });
    return c.json(res);
  });

  app.post("/policy/overrides", async (c) => {
    const tenantId = requireTenantId(c);
    const body = (await c.req.json()) as unknown;
    const parsed = PolicyOverrideCreateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }
    const createdBy = parsed.data.created_by ?? {
      kind: "http",
      ip: getClientIp(c),
      user_agent: c.req.header("user-agent") ?? undefined,
    };

    const result = await policyAdmin.createOverride({
      tenantId,
      agentId: parsed.data.agent_id,
      workspaceId: parsed.data.workspace_id,
      toolId: parsed.data.tool_id,
      pattern: parsed.data.pattern,
      createdBy,
      createdFromApprovalId: parsed.data.created_from_approval_id,
      createdFromPolicySnapshotId: parsed.data.created_from_policy_snapshot_id,
      expiresAt: parsed.data.expires_at ?? null,
    });
    if (!result.ok) {
      return c.json({ error: result.code, message: result.message }, 400);
    }
    const row = result.override;

    const persistedEvent = await ensurePolicyOverrideCreatedEvent({
      tenantId,
      override: row,
      audience: POLICY_WS_AUDIENCE,
      wsEventDal: deps.wsEventDal,
    });
    emitEvent(deps, tenantId, persistedEvent.event, persistedEvent.audience);

    const res = PolicyOverrideCreateResponse.parse({ override: row });
    return c.json(res, 201);
  });

  app.post("/policy/overrides/revoke", async (c) => {
    const tenantId = requireTenantId(c);
    const body = (await c.req.json()) as unknown;
    const parsed = PolicyOverrideRevokeRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const revokedBy = {
      kind: "http",
      ip: getClientIp(c),
      user_agent: c.req.header("user-agent") ?? undefined,
    };

    const row = await policyAdmin.revokeOverride({
      tenantId,
      policyOverrideId: parsed.data.policy_override_id,
      revokedBy,
      reason: parsed.data.reason,
    });
    if (!row) {
      return c.json({ error: "not_found", message: "override not found or not active" }, 404);
    }

    const evt: WsEventEnvelope = {
      event_id: crypto.randomUUID(),
      type: "policy_override.revoked",
      occurred_at: new Date().toISOString(),
      payload: { override: row },
    };
    emitEvent(deps, tenantId, evt);

    const res = PolicyOverrideRevokeResponse.parse({ override: row });
    return c.json(res);
  });

  return app;
}
