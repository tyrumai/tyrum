import { randomUUID } from "node:crypto";
import type { WorkItem, WorkItemState, WorkScope } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import { LaneQueueSignalDal } from "../lanes/queue-signal-dal.js";

import * as dalHelpers from "./dal-helpers.js";
import type * as DalHelpers from "./dal-helpers.js";

export class WorkboardItemTransitionsDal {
  constructor(private readonly db: SqlDb) {}

  async transitionItem(params: {
    scope: WorkScope;
    work_item_id: string;
    status: WorkItemState;
    reason?: string;
    occurredAtIso?: string;
  }): Promise<WorkItem | undefined> {
    const occurredAtIso = params.occurredAtIso ?? new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      const existing = await this.getScopedItem(tx, params.scope, params.work_item_id);
      if (!existing) return undefined;

      const from = existing.status as WorkItemState;
      this.assertTransitionAllowed(from, params.status);
      await this.enforceReadyGate(tx, params.scope, existing, params.status);
      await this.enforceDoingLimit(tx, params.scope, from, params.status);

      const updated = await this.updateItemStatus(
        tx,
        params.scope,
        params.work_item_id,
        params.status,
        occurredAtIso,
      );
      if (!updated) return undefined;

      await this.insertTransitionEvent(
        tx,
        params.scope.tenant_id,
        params.work_item_id,
        existing.status,
        params.status,
        params.reason,
        occurredAtIso,
      );

      if (dalHelpers.isTerminalWorkItemState(params.status)) {
        await this.applyTerminalCleanup(
          tx,
          params.scope,
          params.work_item_id,
          params.status,
          params.reason,
          occurredAtIso,
        );
      }

      return dalHelpers.toWorkItem(updated);
    });
  }

  private async getScopedItem(
    tx: SqlDb,
    scope: WorkScope,
    workItemId: string,
  ): Promise<DalHelpers.RawWorkItemRow | undefined> {
    return await tx.get<DalHelpers.RawWorkItemRow>(
      `SELECT *
       FROM work_items
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?`,
      [scope.tenant_id, scope.agent_id, scope.workspace_id, workItemId],
    );
  }

  private assertTransitionAllowed(from: WorkItemState, to: WorkItemState): void {
    const allowed = dalHelpers.WORK_ITEM_TRANSITIONS[from];
    if (!allowed) {
      throw new dalHelpers.WorkboardTransitionError(
        "invalid_transition",
        { code: "invalid_transition", from, to, allowed: [] },
        `invalid transition from ${from} to ${to}`,
      );
    }
    if (allowed.includes(to)) {
      return;
    }
    throw new dalHelpers.WorkboardTransitionError(
      "invalid_transition",
      { code: "invalid_transition", from, to, allowed },
      `invalid transition from ${from} to ${to}`,
    );
  }

  private async enforceReadyGate(
    tx: SqlDb,
    scope: WorkScope,
    existing: DalHelpers.RawWorkItemRow,
    to: WorkItemState,
  ): Promise<void> {
    if (to !== "ready" && to !== "doing") {
      return;
    }

    const reasons: string[] = [];
    const from = existing.status as WorkItemState;
    if (to === "ready" && from === "doing") {
      return;
    }
    const workItemId = existing.work_item_id;

    const refinementPhase = await this.getWorkItemStateString(
      tx,
      scope,
      workItemId,
      "work.refinement.phase",
    );
    if (!refinementPhase) {
      return;
    }

    if (existing.acceptance_json === null) {
      reasons.push("acceptance_missing");
    }

    const openClarifications = await tx.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM work_clarifications
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?
         AND status = 'open'`,
      [scope.tenant_id, scope.agent_id, scope.workspace_id, workItemId],
    );
    if (dalHelpers.normalizeCount(openClarifications?.count) > 0) {
      reasons.push("open_clarifications");
    }

    const sizeClass = await this.getWorkItemStateString(tx, scope, workItemId, "work.size.class");
    if (!sizeClass || !["small", "medium", "large", "split_required"].includes(sizeClass)) {
      reasons.push("size_missing");
    }

    if (refinementPhase === "awaiting_clarification") {
      reasons.push("awaiting_clarification");
    }

    const readinessReason = await this.getWorkItemStateString(
      tx,
      scope,
      workItemId,
      "work.readiness.reason",
    );
    if (readinessReason) {
      reasons.push(`readiness_blocker:${readinessReason}`);
    }

    if (sizeClass === "split_required") {
      const childItems = await tx.get<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM work_items
         WHERE tenant_id = ?
           AND agent_id = ?
           AND workspace_id = ?
           AND parent_work_item_id = ?`,
        [scope.tenant_id, scope.agent_id, scope.workspace_id, workItemId],
      );
      const executionTasks = await tx.get<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM work_item_tasks t
         JOIN work_items i ON i.tenant_id = t.tenant_id AND i.work_item_id = t.work_item_id
         WHERE i.tenant_id = ?
           AND i.agent_id = ?
           AND i.workspace_id = ?
           AND t.tenant_id = ?
           AND t.work_item_id = ?
           AND t.execution_profile <> 'planner'`,
        [scope.tenant_id, scope.agent_id, scope.workspace_id, scope.tenant_id, workItemId],
      );
      if (
        dalHelpers.normalizeCount(childItems?.count) === 0 &&
        dalHelpers.normalizeCount(executionTasks?.count) === 0
      ) {
        reasons.push("split_required_without_children_or_execution_tasks");
      }
    }

    if (reasons.length === 0) {
      return;
    }

    throw new dalHelpers.WorkboardTransitionError(
      "readiness_gate_failed",
      {
        code: "readiness_gate_failed",
        from,
        to,
        allowed: dalHelpers.WORK_ITEM_TRANSITIONS[from],
        reasons,
      },
      `readiness gate failed: ${reasons.join(", ")}`,
    );
  }

  private async getWorkItemStateString(
    tx: SqlDb,
    scope: WorkScope,
    workItemId: string,
    key: string,
  ): Promise<string | undefined> {
    const row = await tx.get<{ value_json: string | null }>(
      `SELECT value_json
       FROM work_item_state_kv
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?
         AND key = ?`,
      [scope.tenant_id, scope.agent_id, scope.workspace_id, workItemId, key],
    );
    const parsed = dalHelpers.parseJsonOr(row?.value_json ?? null, null);
    return typeof parsed === "string" && parsed.trim().length > 0 ? parsed.trim() : undefined;
  }

  private async updateItemStatus(
    tx: SqlDb,
    scope: WorkScope,
    workItemId: string,
    status: WorkItemState,
    occurredAtIso: string,
  ): Promise<DalHelpers.RawWorkItemRow | undefined> {
    return await tx.get<DalHelpers.RawWorkItemRow>(
      `UPDATE work_items
       SET status = ?, updated_at = ?
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?
       RETURNING *`,
      [status, occurredAtIso, scope.tenant_id, scope.agent_id, scope.workspace_id, workItemId],
    );
  }

  private async insertTransitionEvent(
    tx: SqlDb,
    tenantId: string,
    workItemId: string,
    from: string,
    to: WorkItemState,
    reason: string | undefined,
    occurredAtIso: string,
  ): Promise<void> {
    await tx.run(
      `INSERT INTO work_item_events (tenant_id, event_id, work_item_id, created_at, kind, payload_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        randomUUID(),
        workItemId,
        occurredAtIso,
        "status.transition",
        JSON.stringify({ from, to, reason: reason ?? null }),
      ],
    );
  }

  private async applyTerminalCleanup(
    tx: SqlDb,
    scope: WorkScope,
    workItemId: string,
    status: WorkItemState,
    reason: string | undefined,
    occurredAtIso: string,
  ): Promise<void> {
    const reasonText = reason?.trim() || `work item ${status}`;
    const parsedOccurredAtMs = Date.parse(occurredAtIso);
    const occurredAtMs = Number.isFinite(parsedOccurredAtMs) ? parsedOccurredAtMs : Date.now();

    await tx.run(
      `UPDATE work_item_tasks
       SET status = 'cancelled',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           updated_at = ?,
           finished_at = COALESCE(finished_at, ?)
       WHERE tenant_id = ?
         AND work_item_id = ?
         AND status IN ('queued', 'leased', 'running', 'paused')`,
      [occurredAtIso, occurredAtIso, scope.tenant_id, workItemId],
    );

    const signals = new LaneQueueSignalDal(tx);
    const runningSubagents = await tx.all<{ session_key: string; lane: string }>(
      `SELECT session_key, lane
       FROM subagents
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?
         AND status = 'running'`,
      [scope.tenant_id, scope.agent_id, scope.workspace_id, workItemId],
    );

    for (const subagent of runningSubagents) {
      await signals.setSignal({
        tenant_id: scope.tenant_id,
        key: subagent.session_key,
        lane: subagent.lane,
        kind: "interrupt",
        inbox_id: null,
        queue_mode: "interrupt",
        message_text: reasonText,
        created_at_ms: occurredAtMs,
      });
    }

    await tx.run(
      `UPDATE subagents
       SET status = 'closed',
           updated_at = ?,
           closed_at = COALESCE(closed_at, ?),
           close_reason = COALESCE(close_reason, ?)
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?
         AND status NOT IN ('closed', 'failed')`,
      [
        occurredAtIso,
        occurredAtIso,
        reasonText,
        scope.tenant_id,
        scope.agent_id,
        scope.workspace_id,
        workItemId,
      ],
    );
  }

  private async enforceDoingLimit(
    tx: SqlDb,
    scope: WorkScope,
    from: WorkItemState,
    to: WorkItemState,
  ): Promise<void> {
    if (to !== "doing") {
      return;
    }

    if (tx.kind === "postgres") {
      await tx.get("SELECT pg_advisory_xact_lock($1, $2)", [
        dalHelpers.hashScopeLockSeed(`${scope.tenant_id}|${scope.agent_id}`),
        dalHelpers.hashScopeLockSeed(scope.workspace_id),
      ]);
    }

    const doingCount = await tx.get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM work_items
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND status = 'doing'`,
      [scope.tenant_id, scope.agent_id, scope.workspace_id],
    );
    const currentDoing = dalHelpers.normalizeCount(doingCount?.count);
    if (currentDoing < dalHelpers.DEFAULT_WORK_ITEM_WIP_LIMIT) {
      return;
    }

    throw new dalHelpers.WorkboardTransitionError(
      "wip_limit_exceeded",
      {
        code: "wip_limit_exceeded",
        from,
        to: "doing",
        limit: dalHelpers.DEFAULT_WORK_ITEM_WIP_LIMIT,
        current: currentDoing,
      },
      `WIP limit ${dalHelpers.DEFAULT_WORK_ITEM_WIP_LIMIT} reached for doing items`,
    );
  }
}
