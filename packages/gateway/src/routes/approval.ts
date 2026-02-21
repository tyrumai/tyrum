/**
 * Approval queue REST routes.
 *
 * Provides endpoints for listing, viewing, and responding to pending
 * human approval requests.
 */

import { Hono } from "hono";
import type { ApprovalDal, ApprovalStatus } from "../modules/approval/dal.js";
import type { PolicyOverrideDal } from "../modules/policy/override-dal.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { WsEventEnvelope } from "@tyrum/schemas";
import type { ExecutionEngine } from "../modules/execution/engine.js";
import { toApprovalContract } from "../modules/approval/to-contract.js";

const VALID_STATUSES = new Set<ApprovalStatus>([
  "pending",
  "approved",
  "denied",
  "expired",
  "cancelled",
]);

export interface ApprovalRouteDeps {
  approvalDal: ApprovalDal;
  policyOverrideDal?: PolicyOverrideDal;
  engine?: ExecutionEngine;
  ws?: {
    connectionManager: ConnectionManager;
    cluster?: {
      edgeId: string;
      outboxDal: OutboxDal;
    };
  };
}

function emitEvent(deps: ApprovalRouteDeps, evt: WsEventEnvelope): void {
  const ws = deps.ws;
  if (!ws) return;

  const payload = JSON.stringify(evt);
  for (const client of ws.connectionManager.allClients()) {
    try {
      client.ws.send(payload);
    } catch {
      // ignore
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

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractSuggestedOverrides(approvalContext: unknown): Array<{ tool_id: string; pattern: string; workspace_id?: string }> {
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

function extractAgentId(approvalContext: unknown): string | undefined {
  if (!isObject(approvalContext)) return undefined;
  const policy = approvalContext["policy"];
  if (!isObject(policy)) return undefined;
  const value = policy["agent_id"];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function createApprovalRoutes(deps: ApprovalRouteDeps): Hono {
  const app = new Hono();

  /** List approvals. Defaults to pending; use ?status= to filter. */
  app.get("/approvals", async (c) => {
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

    const approvals = await deps.approvalDal.getByStatus(status ?? "pending");
    return c.json({ approvals });
  });

  /** Get a single approval by id. */
  app.get("/approvals/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) {
      return c.json(
        { error: "invalid_request", message: "id must be a number" },
        400,
      );
    }

    const approval = await deps.approvalDal.getById(id);
    if (!approval) {
      return c.json(
        { error: "not_found", message: `approval ${String(id)} not found` },
        404,
      );
    }

    return c.json({ approval });
  });

  /** Respond to a pending approval (approve or deny). */
  app.post("/approvals/:id/respond", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) {
      return c.json(
        { error: "invalid_request", message: "id must be a number" },
        400,
      );
    }

    const body = (await c.req.json()) as {
      decision?: "approved" | "denied";
      approved?: boolean;
      reason?: string;
      mode?: "once" | "always";
      overrides?: Array<{ tool_id?: string; pattern?: string; workspace_id?: string }>;
    };

    // Accept either { decision: "approved"|"denied" } or legacy { approved: boolean }
    let isApproved: boolean;
    if (body.decision === "approved" || body.decision === "denied") {
      isApproved = body.decision === "approved";
    } else if (typeof body.approved === "boolean") {
      isApproved = body.approved;
    } else {
      return c.json(
        {
          error: "invalid_request",
          message:
            'decision ("approved" or "denied") or approved (boolean) is required',
        },
        400,
      );
    }

    const updated = await deps.approvalDal.respond(id, isApproved, body.reason);
    if (!updated) {
      return c.json(
        {
          error: "not_found",
          message: `approval ${String(id)} not found or already responded`,
        },
        404,
      );
    }

    if (deps.engine && updated.resume_token && updated.run_id) {
      if (isApproved) {
        await deps.engine.resumeRun(updated.resume_token);
      } else {
        await deps.engine.cancelRun(updated.run_id, body.reason ?? "approval denied");
      }
    }

    const createdOverrides: unknown[] = [];

    if (isApproved && body.mode === "always") {
      const overrideDal = deps.policyOverrideDal;
      if (!overrideDal) {
        return c.json({ error: "unsupported", message: "policy overrides not configured" }, 400);
      }

      const suggested = extractSuggestedOverrides(updated.context);
      const selected = Array.isArray(body.overrides) ? body.overrides : [];
      const selectedNormalized = selected
        .map((o) => {
          const toolId = typeof o.tool_id === "string" ? o.tool_id.trim() : "";
          const pattern = typeof o.pattern === "string" ? o.pattern.trim() : "";
          const workspaceId = typeof o.workspace_id === "string" ? o.workspace_id.trim() : undefined;
          if (!toolId || !pattern) return null;
          return workspaceId ? { tool_id: toolId, pattern, workspace_id: workspaceId } : { tool_id: toolId, pattern };
        })
        .filter((o): o is { tool_id: string; pattern: string; workspace_id?: string } => o !== null);

      if (selectedNormalized.length === 0) {
        return c.json(
          {
            error: "invalid_request",
            message: "mode=always requires selecting one or more overrides",
          },
          400,
        );
      }

      const allowed = new Set(suggested.map((s) => `${s.tool_id}::${s.pattern}::${s.workspace_id ?? ""}`));
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
      }

      const createdBy = {
        kind: "http",
        ip: c.req.header("x-forwarded-for") ?? undefined,
        user_agent: c.req.header("user-agent") ?? undefined,
      };
      const agentId = extractAgentId(updated.context) ?? "default";
      const snapshotId = extractPolicySnapshotId(updated.context);

      for (const sel of selectedNormalized) {
        const row = await overrideDal.create({
          agentId,
          workspaceId: sel.workspace_id,
          toolId: sel.tool_id,
          pattern: sel.pattern,
          createdBy,
          createdFromApprovalId: updated.id,
          createdFromPolicySnapshotId: snapshotId,
        });
        createdOverrides.push(row);

        const evt: WsEventEnvelope = {
          event_id: crypto.randomUUID(),
          type: "policy_override.created",
          occurred_at: new Date().toISOString(),
          payload: { override: row },
        };
        emitEvent(deps, evt);
      }
    }

    const contract = toApprovalContract(updated);
    if (contract) {
      const approvalResolvedEvt: WsEventEnvelope = {
        event_id: crypto.randomUUID(),
        type: "approval.resolved",
        occurred_at: new Date().toISOString(),
        payload: { approval: contract },
      };
      emitEvent(deps, approvalResolvedEvt);
    }

    return c.json({ approval: updated, created_overrides: createdOverrides.length > 0 ? createdOverrides : undefined });
  });

  /** Preview the context of a pending approval. */
  app.get("/approvals/:id/preview", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) {
      return c.json(
        { error: "invalid_request", message: "id must be a number" },
        400,
      );
    }

    const approval = await deps.approvalDal.getById(id);
    if (!approval) {
      return c.json(
        { error: "not_found", message: `approval ${String(id)} not found` },
        404,
      );
    }

    return c.json({
      id: approval.id,
      plan_id: approval.plan_id,
      step_index: approval.step_index,
      prompt: approval.prompt,
      context: approval.context,
      status: approval.status,
      expires_at: approval.expires_at,
    });
  });

  return app;
}
