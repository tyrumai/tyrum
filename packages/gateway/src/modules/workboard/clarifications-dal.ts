import { randomUUID } from "node:crypto";
import type { WorkClarification, WorkClarificationStatus, WorkScope } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";

import type { GetItemFn } from "./dal-deps.js";
import * as dalHelpers from "./dal-helpers.js";
import type * as DalHelpers from "./dal-helpers.js";

type WorkboardClarificationsDalDependencies = {
  db: SqlDb;
  getItem: GetItemFn;
};

export class WorkboardClarificationsDal {
  constructor(private readonly deps: WorkboardClarificationsDalDependencies) {}

  async createClarification(params: {
    scope: WorkScope;
    clarification: {
      work_item_id: string;
      question: string;
      requested_by_subagent_id?: string;
      requested_for_session_key: string;
    };
    clarificationId?: string;
    requestedAtIso?: string;
  }): Promise<WorkClarification> {
    const clarificationId = params.clarificationId?.trim() || randomUUID();
    const requestedAtIso = params.requestedAtIso ?? new Date().toISOString();
    await this.assertWorkItemInScope(params.scope, params.clarification.work_item_id);

    const row = await this.deps.db.get<DalHelpers.RawWorkClarificationRow>(
      `INSERT INTO work_clarifications (
         clarification_id,
         tenant_id,
         agent_id,
         workspace_id,
         work_item_id,
         status,
         question,
         requested_by_subagent_id,
         requested_for_session_key,
         requested_at,
         answered_at,
         answer_text,
         answered_by_session_key,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, NULL, NULL, NULL, ?)
       RETURNING *`,
      [
        clarificationId,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.clarification.work_item_id,
        params.clarification.question,
        params.clarification.requested_by_subagent_id ?? null,
        params.clarification.requested_for_session_key,
        requestedAtIso,
        requestedAtIso,
      ],
    );
    if (!row) {
      throw new Error("work clarification insert failed");
    }
    return dalHelpers.toWorkClarification(row);
  }

  async getClarification(params: {
    scope: WorkScope;
    clarification_id: string;
  }): Promise<WorkClarification | undefined> {
    const row = await this.deps.db.get<DalHelpers.RawWorkClarificationRow>(
      `SELECT *
       FROM work_clarifications
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND clarification_id = ?`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.clarification_id,
      ],
    );
    return row ? dalHelpers.toWorkClarification(row) : undefined;
  }

  async listClarifications(params: {
    scope: WorkScope;
    work_item_id?: string;
    statuses?: WorkClarificationStatus[];
    limit?: number;
    cursor?: string;
  }): Promise<{ clarifications: WorkClarification[]; next_cursor?: string }> {
    const where: string[] = ["tenant_id = ?", "agent_id = ?", "workspace_id = ?"];
    const values: unknown[] = [
      params.scope.tenant_id,
      params.scope.agent_id,
      params.scope.workspace_id,
    ];

    if (params.work_item_id) {
      where.push("work_item_id = ?");
      values.push(params.work_item_id);
    }

    if (params.statuses && params.statuses.length > 0) {
      where.push(`status IN (${params.statuses.map(() => "?").join(", ")})`);
      values.push(...params.statuses);
    }

    if (params.cursor) {
      const cursor = dalHelpers.decodeCursor(params.cursor);
      where.push("(updated_at < ? OR (updated_at = ? AND clarification_id < ?))");
      values.push(cursor.sort, cursor.sort, cursor.id);
    }

    const limit = Math.max(1, Math.min(200, params.limit ?? 50));
    values.push(limit);

    const rows = await this.deps.db.all<DalHelpers.RawWorkClarificationRow>(
      `SELECT *
       FROM work_clarifications
       WHERE ${where.join(" AND ")}
       ORDER BY updated_at DESC, clarification_id DESC
       LIMIT ?`,
      values,
    );
    const clarifications = rows.map(dalHelpers.toWorkClarification);
    const last = clarifications.at(-1);
    const next_cursor =
      clarifications.length === limit && last
        ? dalHelpers.encodeCursor({ sort: last.updated_at, id: last.clarification_id })
        : undefined;

    return { clarifications, next_cursor };
  }

  async answerClarification(params: {
    scope: WorkScope;
    clarification_id: string;
    answer_text: string;
    answered_by_session_key: string;
    answeredAtIso?: string;
  }): Promise<WorkClarification | undefined> {
    const answeredAtIso = params.answeredAtIso ?? new Date().toISOString();
    const row = await this.deps.db.get<DalHelpers.RawWorkClarificationRow>(
      `UPDATE work_clarifications
       SET status = 'answered',
           answer_text = ?,
           answered_by_session_key = ?,
           answered_at = COALESCE(answered_at, ?),
           updated_at = ?
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND clarification_id = ?
         AND status = 'open'
       RETURNING *`,
      [
        params.answer_text,
        params.answered_by_session_key,
        answeredAtIso,
        answeredAtIso,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.clarification_id,
      ],
    );

    if (row) {
      return dalHelpers.toWorkClarification(row);
    }
    return await this.getClarification({
      scope: params.scope,
      clarification_id: params.clarification_id,
    });
  }

  async cancelClarification(params: {
    scope: WorkScope;
    clarification_id: string;
    cancelledAtIso?: string;
  }): Promise<WorkClarification | undefined> {
    const cancelledAtIso = params.cancelledAtIso ?? new Date().toISOString();
    const row = await this.deps.db.get<DalHelpers.RawWorkClarificationRow>(
      `UPDATE work_clarifications
       SET status = 'cancelled',
           updated_at = ?
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND clarification_id = ?
         AND status = 'open'
       RETURNING *`,
      [
        cancelledAtIso,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.clarification_id,
      ],
    );

    if (row) {
      return dalHelpers.toWorkClarification(row);
    }
    return await this.getClarification({
      scope: params.scope,
      clarification_id: params.clarification_id,
    });
  }

  private async assertWorkItemInScope(scope: WorkScope, workItemId: string): Promise<void> {
    const item = await this.deps.getItem({ scope, work_item_id: workItemId });
    if (!item) {
      throw new Error("work_item_id is outside scope");
    }
  }
}
