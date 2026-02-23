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
} from "@tyrum/schemas";
import { Hono } from "hono";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { PolicyOverrideDal } from "../modules/policy/override-dal.js";
import type { PolicyService } from "../modules/policy/service.js";

export interface PolicyBundleRouteDeps {
  policyService: PolicyService;
  policyOverrideDal: PolicyOverrideDal;
  ws?: {
    connectionManager: ConnectionManager;
    cluster?: {
      edgeId: string;
      outboxDal: OutboxDal;
    };
  };
}

function emitEvent(deps: PolicyBundleRouteDeps, evt: WsEventEnvelope): void {
  const ws = deps.ws;
  if (!ws) return;

  const payload = JSON.stringify(evt);
  for (const client of ws.connectionManager.allClients()) {
    try {
      client.ws.send(payload);
    } catch {
      // ignore best-effort sends
    }
  }

  if (ws.cluster) {
    void ws.cluster.outboxDal
      .enqueue("ws.broadcast", {
        source_edge_id: ws.cluster.edgeId,
        skip_local: true,
        message: evt,
      })
      .catch(() => {
        // ignore
      });
  }
}

export function createPolicyBundleRoutes(deps: PolicyBundleRouteDeps): Hono {
  const app = new Hono();

  app.get("/policy/bundle", async (c) => {
    const effective = await deps.policyService.loadEffectiveBundle();
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

    const expired = await deps.policyOverrideDal.expireStale();
    for (const row of expired) {
      const evt: WsEventEnvelope = {
        event_id: crypto.randomUUID(),
        type: "policy_override.expired",
        occurred_at: new Date().toISOString(),
        payload: { override: row },
      };
      emitEvent(deps, evt);
    }
    const rows = await deps.policyOverrideDal.list({
      agentId: parsed.data.agent_id,
      toolId: parsed.data.tool_id,
      status: parsed.data.status,
      limit: parsed.data.limit,
    });
    const res = PolicyOverrideListResponse.parse({ overrides: rows, next_cursor: undefined });
    return c.json(res);
  });

  app.post("/policy/overrides", async (c) => {
    const body = (await c.req.json()) as unknown;
    const parsed = PolicyOverrideCreateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const createdBy = parsed.data.created_by ?? {
      kind: "http",
      ip: c.req.header("x-forwarded-for") ?? undefined,
      user_agent: c.req.header("user-agent") ?? undefined,
    };

    const row = await deps.policyOverrideDal.create({
      agentId: parsed.data.agent_id,
      workspaceId: parsed.data.workspace_id,
      toolId: parsed.data.tool_id,
      pattern: parsed.data.pattern,
      createdBy,
      createdFromApprovalId: parsed.data.created_from_approval_id,
      createdFromPolicySnapshotId: parsed.data.created_from_policy_snapshot_id,
      expiresAt: parsed.data.expires_at ?? null,
    });

    const evt: WsEventEnvelope = {
      event_id: crypto.randomUUID(),
      type: "policy_override.created",
      occurred_at: new Date().toISOString(),
      payload: { override: row },
    };
    emitEvent(deps, evt);

    const res = PolicyOverrideCreateResponse.parse({ override: row });
    return c.json(res, 201);
  });

  app.post("/policy/overrides/revoke", async (c) => {
    const body = (await c.req.json()) as unknown;
    const parsed = PolicyOverrideRevokeRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const revokedBy = {
      kind: "http",
      ip: c.req.header("x-forwarded-for") ?? undefined,
      user_agent: c.req.header("user-agent") ?? undefined,
    };

    const row = await deps.policyOverrideDal.revoke({
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
    emitEvent(deps, evt);

    const res = PolicyOverrideRevokeResponse.parse({ override: row });
    return c.json(res);
  });

  return app;
}
