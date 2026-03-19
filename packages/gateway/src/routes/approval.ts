/**
 * Approval queue REST routes.
 *
 * Provides endpoints for listing, viewing, and responding to pending
 * human approval requests.
 */

import type { PolicyOverrideStore } from "@tyrum/runtime-policy";
import { Hono } from "hono";
import {
  isApprovalTerminalStatus,
  type ApprovalDal,
  type ApprovalStatus,
} from "../modules/approval/dal.js";
import type { Logger } from "../modules/observability/logger.js";
import type { WsEventDal } from "../modules/ws-event/dal.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { WsEventEnvelope } from "@tyrum/contracts";
import { UuidSchema } from "@tyrum/contracts";
import { getClientIp } from "../modules/auth/client-ip.js";
import { requireTenantId } from "../modules/auth/claims.js";
import { type WsBroadcastAudience } from "../ws/audience.js";
import { broadcastWsEvent } from "../ws/broadcast.js";
import { resolveApproval } from "../modules/approval/resolve-service.js";
import { toApprovalContract } from "../modules/approval/to-contract.js";

const VALID_STATUSES = new Set<ApprovalStatus>([
  "queued",
  "reviewing",
  "awaiting_human",
  "approved",
  "denied",
  "expired",
  "cancelled",
]);

export interface ApprovalRouteDeps {
  approvalDal: ApprovalDal;
  logger?: Logger;
  policyOverrideDal?: PolicyOverrideStore;
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
  deps: ApprovalRouteDeps,
  tenantId: string,
  evt: WsEventEnvelope,
  audience?: WsBroadcastAudience,
): void {
  const ws = deps.ws;
  if (!ws) return;
  broadcastWsEvent(tenantId, evt, { ...ws, logger: deps.logger }, audience);
}

export function createApprovalRoutes(deps: ApprovalRouteDeps): Hono {
  const app = new Hono();

  /** List approvals. Defaults to blocked approvals; use ?status= to filter. */
  app.get("/approvals", async (c) => {
    const tenantId = requireTenantId(c);
    const status = c.req.query("status") as ApprovalStatus | undefined;

    if (status && !VALID_STATUSES.has(status)) {
      return c.json(
        {
          error: "invalid_request",
          message: `Invalid status. Allowed: ${[...VALID_STATUSES].join(", ")}`,
        },
        400,
      );
    }

    const approvals = status
      ? await deps.approvalDal.getByStatus({
          tenantId,
          status,
          newestFirst: isApprovalTerminalStatus(status),
        })
      : await deps.approvalDal.listBlocked({ tenantId });
    return c.json({
      approvals: approvals.map((approval) => toApprovalContract(approval) ?? approval),
    });
  });

  /** Get a single approval by id. */
  app.get("/approvals/:id", async (c) => {
    const tenantId = requireTenantId(c);
    const id = c.req.param("id");
    const parsedId = UuidSchema.safeParse(id);
    if (!parsedId.success) {
      return c.json({ error: "invalid_request", message: "id must be a UUID" }, 400);
    }

    const approval = await deps.approvalDal.getById({
      tenantId,
      approvalId: parsedId.data,
      includeReviews: true,
    });
    if (!approval) {
      return c.json({ error: "not_found", message: `approval ${String(id)} not found` }, 404);
    }

    return c.json({ approval: toApprovalContract(approval) ?? approval });
  });

  /** Respond to an approval awaiting human review (approve or deny). */
  app.post("/approvals/:id/respond", async (c) => {
    const tenantId = requireTenantId(c);
    const parsedId = UuidSchema.safeParse(c.req.param("id"));
    if (!parsedId.success) {
      return c.json({ error: "invalid_request", message: "id must be a UUID" }, 400);
    }

    const body = (await c.req.json()) as {
      decision?: "approved" | "denied";
      reason?: unknown;
      mode?: unknown;
      overrides?: Array<{ tool_id?: unknown; pattern?: unknown; workspace_id?: unknown }>;
    };

    let decision: "approved" | "denied";
    if (body.decision === "approved" || body.decision === "denied") {
      decision = body.decision;
    } else {
      return c.json(
        {
          error: "invalid_request",
          message: 'decision ("approved" or "denied") is required',
        },
        400,
      );
    }

    const resolvedBy = {
      kind: "http" as const,
      ip: getClientIp(c),
      user_agent: c.req.header("user-agent") ?? undefined,
    };
    const result = await resolveApproval(
      {
        approvalDal: deps.approvalDal,
        policyOverrideDal: deps.policyOverrideDal,
        wsEventDal: deps.wsEventDal,
        emitEvent: ({ tenantId: eventTenantId, event, audience }) => {
          emitEvent(deps, eventTenantId, event, audience);
        },
      },
      {
        tenantId,
        approvalId: parsedId.data,
        decision,
        reason: typeof body.reason === "string" ? body.reason : undefined,
        mode: body.mode === "always" || body.mode === "once" ? body.mode : undefined,
        overrides: Array.isArray(body.overrides) ? body.overrides : undefined,
        resolvedBy,
      },
    );
    if (!result.ok) {
      return c.json(
        {
          error: result.code,
          message: result.message,
        },
        result.code === "not_found" ? 404 : 400,
      );
    }

    return c.json({
      approval: toApprovalContract(result.approval) ?? result.approval,
      created_overrides: result.createdOverrides,
    });
  });

  /** Preview the context of an approval. */
  app.get("/approvals/:id/preview", async (c) => {
    const tenantId = requireTenantId(c);
    const id = c.req.param("id");
    const parsedId = UuidSchema.safeParse(id);
    if (!parsedId.success) {
      return c.json({ error: "invalid_request", message: "id must be a UUID" }, 400);
    }

    const approval = await deps.approvalDal.getById({
      tenantId,
      approvalId: parsedId.data,
    });
    if (!approval) {
      return c.json({ error: "not_found", message: `approval ${String(id)} not found` }, 404);
    }

    return c.json({
      approval_id: approval.approval_id,
      approval_key: approval.approval_key,
      prompt: approval.prompt,
      motivation: approval.motivation,
      context: approval.context,
      status: approval.status,
      expires_at: approval.expires_at,
    });
  });

  return app;
}
