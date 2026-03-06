/**
 * Approval queue REST routes.
 *
 * Provides endpoints for listing, viewing, and responding to pending
 * human approval requests.
 */

import { Hono } from "hono";
import type { ApprovalDal, ApprovalStatus } from "../modules/approval/dal.js";
import type { PolicyOverrideDal } from "../modules/policy/override-dal.js";
import type { Logger } from "../modules/observability/logger.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { WsEventEnvelope } from "@tyrum/schemas";
import { UuidSchema } from "@tyrum/schemas";
import { toApprovalContract } from "../modules/approval/to-contract.js";
import { isSafeSuggestedOverridePattern } from "../modules/policy/override-guardrails.js";
import { getClientIp } from "../modules/auth/client-ip.js";
import { requireTenantId } from "../modules/auth/claims.js";
import { broadcastWsEvent } from "../ws/broadcast.js";

const VALID_STATUSES = new Set<ApprovalStatus>([
  "pending",
  "approved",
  "denied",
  "expired",
  "cancelled",
]);

export interface ApprovalRouteDeps {
  approvalDal: ApprovalDal;
  logger?: Logger;
  policyOverrideDal?: PolicyOverrideDal;
  ws?: {
    connectionManager: ConnectionManager;
    maxBufferedBytes?: number;
    cluster?: {
      edgeId: string;
      outboxDal: OutboxDal;
    };
  };
}

function emitEvent(deps: ApprovalRouteDeps, tenantId: string, evt: WsEventEnvelope): void {
  const ws = deps.ws;
  if (!ws) return;
  broadcastWsEvent(tenantId, evt, { ...ws, logger: deps.logger });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractSuggestedOverrides(
  approvalContext: unknown,
): Array<{ tool_id: string; pattern: string; workspace_id?: string }> {
  if (!isObject(approvalContext)) return [];
  const policy = approvalContext["policy"];
  if (!isObject(policy)) return [];
  const suggested = policy["suggested_overrides"];
  if (!Array.isArray(suggested)) return [];

  const out: Array<{ tool_id: string; pattern: string; workspace_id?: string }> = [];
  for (const entry of suggested) {
    if (!isObject(entry)) continue;
    const toolId = entry["tool_id"];
    const pattern = entry["pattern"];
    const workspaceId = entry["workspace_id"];
    if (typeof toolId === "string" && typeof pattern === "string") {
      out.push({
        tool_id: toolId,
        pattern,
        workspace_id: typeof workspaceId === "string" ? workspaceId : undefined,
      });
    }
  }
  return out;
}

function extractPolicySnapshotId(approvalContext: unknown): string | undefined {
  if (!isObject(approvalContext)) return undefined;
  const policy = approvalContext["policy"];
  if (!isObject(policy)) return undefined;
  const value = policy["policy_snapshot_id"];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function createApprovalRoutes(deps: ApprovalRouteDeps): Hono {
  const app = new Hono();

  /** List approvals. Defaults to pending; use ?status= to filter. */
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

    const approvals = await deps.approvalDal.getByStatus({
      tenantId,
      status: status ?? "pending",
    });
    return c.json({ approvals });
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
    });
    if (!approval) {
      return c.json({ error: "not_found", message: `approval ${String(id)} not found` }, 404);
    }

    return c.json({ approval });
  });

  /** Respond to a pending approval (approve or deny). */
  app.post("/approvals/:id/respond", async (c) => {
    const tenantId = requireTenantId(c);
    const id = c.req.param("id");
    const parsedId = UuidSchema.safeParse(id);
    if (!parsedId.success) {
      return c.json({ error: "invalid_request", message: "id must be a UUID" }, 400);
    }

    const body = (await c.req.json()) as {
      decision?: "approved" | "denied";
      reason?: string;
      mode?: "once" | "always";
      overrides?: Array<{ tool_id?: string; pattern?: string; workspace_id?: string }>;
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

    const existing = await deps.approvalDal.getById({
      tenantId,
      approvalId: parsedId.data,
    });
    if (!existing) {
      return c.json({ error: "not_found", message: `approval ${String(id)} not found` }, 404);
    }

    if (existing.status !== "pending") {
      // Idempotency: if the approval has already been resolved, return the
      // existing state without applying side effects (engine actions, overrides,
      // or duplicate broadcasts).
      return c.json({ approval: existing });
    }

    const shouldCreateOverrides = decision === "approved" && body.mode === "always";
    const selectedNormalized: Array<{ tool_id: string; pattern: string; workspace_id?: string }> =
      [];
    const overrideDalForRequest = shouldCreateOverrides ? deps.policyOverrideDal : undefined;

    if (shouldCreateOverrides) {
      if (!overrideDalForRequest) {
        return c.json({ error: "unsupported", message: "policy overrides not configured" }, 400);
      }

      const suggested = extractSuggestedOverrides(existing.context);
      const selected = Array.isArray(body.overrides) ? body.overrides : [];

      for (const entry of selected) {
        const toolId = typeof entry.tool_id === "string" ? entry.tool_id.trim() : "";
        const pattern = typeof entry.pattern === "string" ? entry.pattern.trim() : "";
        const workspaceId =
          typeof entry.workspace_id === "string" ? entry.workspace_id.trim() : undefined;
        if (!toolId || !pattern) continue;
        selectedNormalized.push(
          workspaceId
            ? { tool_id: toolId, pattern, workspace_id: workspaceId }
            : { tool_id: toolId, pattern },
        );
      }

      if (selectedNormalized.length === 0) {
        return c.json(
          {
            error: "invalid_request",
            message: "mode=always requires selecting one or more overrides",
          },
          400,
        );
      }

      const allowed = new Set(
        suggested.map((s) => `${s.tool_id}::${s.pattern}::${s.workspace_id ?? ""}`),
      );
      for (const sel of selectedNormalized) {
        const key = `${sel.tool_id}::${sel.pattern}::${sel.workspace_id ?? ""}`;
        if (!allowed.has(key)) {
          return c.json(
            {
              error: "invalid_request",
              message: "requested overrides must be selected from suggested_overrides",
            },
            400,
          );
        }
        if (!isSafeSuggestedOverridePattern(sel.pattern)) {
          return c.json(
            {
              error: "invalid_request",
              message: "requested overrides violate deny guardrails",
            },
            400,
          );
        }
      }

      for (const sel of selectedNormalized) {
        if (!sel.workspace_id) continue;
        const parsedWorkspaceId = UuidSchema.safeParse(sel.workspace_id);
        if (!parsedWorkspaceId.success) {
          return c.json({ error: "invalid_request", message: "workspace_id must be a UUID" }, 400);
        }
      }
    }

    const resolved = await deps.approvalDal.resolveWithEngineAction({
      tenantId,
      approvalId: parsedId.data,
      decision,
      reason: body.reason,
      resolvedBy: {
        kind: "http",
        ip: getClientIp(c),
        user_agent: c.req.header("user-agent") ?? undefined,
      },
    });
    if (!resolved) {
      return c.json(
        {
          error: "not_found",
          message: `approval ${String(id)} not found or already responded`,
        },
        404,
      );
    }
    const updated = resolved.approval;
    const transitioned = resolved.transitioned;

    const desiredStatus = decision;
    const decisionMatches = updated.status === desiredStatus;

    const createdOverrides: unknown[] = [];

    if (
      transitioned &&
      decisionMatches &&
      updated.status === "approved" &&
      shouldCreateOverrides &&
      overrideDalForRequest
    ) {
      const createdBy = {
        kind: "http",
        ip: getClientIp(c),
        user_agent: c.req.header("user-agent") ?? undefined,
      };
      const agentId = updated.agent_id;
      const snapshotId = extractPolicySnapshotId(updated.context);

      for (const sel of selectedNormalized) {
        const row = await overrideDalForRequest.create({
          tenantId,
          agentId,
          workspaceId: sel.workspace_id,
          toolId: sel.tool_id,
          pattern: sel.pattern,
          createdBy,
          createdFromApprovalId: updated.approval_id,
          createdFromPolicySnapshotId: snapshotId,
        });
        createdOverrides.push(row);

        const evt: WsEventEnvelope = {
          event_id: crypto.randomUUID(),
          type: "policy_override.created",
          occurred_at: new Date().toISOString(),
          payload: { override: row },
        };
        emitEvent(deps, tenantId, evt);
      }
    }

    const contract = toApprovalContract(updated);
    if (contract && transitioned) {
      const approvalResolvedEvt: WsEventEnvelope = {
        event_id: crypto.randomUUID(),
        type: "approval.resolved",
        occurred_at: new Date().toISOString(),
        payload: { approval: contract },
      };
      emitEvent(deps, tenantId, approvalResolvedEvt);
    }

    return c.json({
      approval: updated,
      created_overrides: createdOverrides.length > 0 ? createdOverrides : undefined,
    });
  });

  /** Preview the context of a pending approval. */
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
      context: approval.context,
      status: approval.status,
      expires_at: approval.expires_at,
    });
  });

  return app;
}
