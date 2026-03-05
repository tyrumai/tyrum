import { randomUUID } from "node:crypto";
import type {
  DecisionRecord,
  WorkArtifact,
  WorkArtifactKind,
  WorkScope,
  WsEventEnvelope,
} from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import type { RedactionEngine } from "../redaction/engine.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";

import * as dalHelpers from "./dal-helpers.js";
import type * as DalHelpers from "./dal-helpers.js";
import { WorkboardItemRelationsDal } from "./item-relations-dal.js";
import { WorkboardItemTransitionsDal } from "./item-transitions-dal.js";
import { WorkboardItemsDal } from "./items-dal.js";
import { WorkboardSignalsDal } from "./signals-dal.js";
import { WorkboardStateKvDal } from "./state-kv-dal.js";
import { WorkboardSubagentDal } from "./subagent-dal.js";
import { WorkboardTaskLeasingDal } from "./task-leasing-dal.js";
import { WorkboardTaskUpdatesDal } from "./task-updates-dal.js";
import { WorkboardTasksDal } from "./tasks-dal.js";

export type { WorkItemEventRow, WorkItemLinkRow, WorkScopeActivityRow } from "./dal-helpers.js";
export type { WorkboardTransitionErrorDetails } from "./dal-helpers.js";
export { WorkboardTransitionError } from "./dal-helpers.js";

export class WorkboardDal {
  private readonly items: WorkboardItemsDal;
  private readonly itemTransitions: WorkboardItemTransitionsDal;
  private readonly itemRelations: WorkboardItemRelationsDal;
  private readonly stateKv: WorkboardStateKvDal;
  private readonly tasks: WorkboardTasksDal;
  private readonly taskUpdates: WorkboardTaskUpdatesDal;
  private readonly taskLeasing: WorkboardTaskLeasingDal;
  private readonly subagents: WorkboardSubagentDal;
  private readonly signals: WorkboardSignalsDal;

  constructor(
    private readonly db: SqlDb,
    private readonly redactionEngine?: RedactionEngine,
  ) {
    this.items = new WorkboardItemsDal(db);
    const getItem = (...args: Parameters<WorkboardItemsDal["getItem"]>) =>
      this.items.getItem(...args);
    this.itemTransitions = new WorkboardItemTransitionsDal(db);
    this.itemRelations = new WorkboardItemRelationsDal({ db, getItem });
    this.stateKv = new WorkboardStateKvDal({ db, getItem });
    this.tasks = new WorkboardTasksDal({ db, getItem });
    this.taskUpdates = new WorkboardTaskUpdatesDal({
      db,
      enqueueWsEventTx: (tx, evt) => this.enqueueWsEventTx(tx, evt),
    });
    this.taskLeasing = new WorkboardTaskLeasingDal({
      db,
      getItem,
      enqueueWsEventTx: (tx, evt) => this.enqueueWsEventTx(tx, evt),
    });
    this.subagents = new WorkboardSubagentDal({ db, getItem });
    this.signals = new WorkboardSignalsDal(db);
  }

  private async enqueueWsEventTx(tx: SqlDb, evt: WsEventEnvelope): Promise<void> {
    const payload = { message: evt, audience: dalHelpers.WORKBOARD_WS_AUDIENCE };
    const redactedPayload = this.redactionEngine
      ? this.redactionEngine.redactUnknown(payload).redacted
      : payload;
    const tenantId =
      typeof (evt.payload as any)?.tenant_id === "string" && (evt.payload as any).tenant_id.trim()
        ? ((evt.payload as any).tenant_id as string)
        : DEFAULT_TENANT_ID;
    await tx.run(
      `INSERT INTO outbox (tenant_id, topic, target_edge_id, payload_json)
       VALUES (?, ?, ?, ?)`,
      [tenantId, "ws.broadcast", null, JSON.stringify(redactedPayload)],
    );
  }

  createItem(
    ...args: Parameters<WorkboardItemsDal["createItem"]>
  ): ReturnType<WorkboardItemsDal["createItem"]> {
    return this.items.createItem(...args);
  }

  getItem(
    ...args: Parameters<WorkboardItemsDal["getItem"]>
  ): ReturnType<WorkboardItemsDal["getItem"]> {
    return this.items.getItem(...args);
  }

  listItems(
    ...args: Parameters<WorkboardItemsDal["listItems"]>
  ): ReturnType<WorkboardItemsDal["listItems"]> {
    return this.items.listItems(...args);
  }

  updateItem(
    ...args: Parameters<WorkboardItemsDal["updateItem"]>
  ): ReturnType<WorkboardItemsDal["updateItem"]> {
    return this.items.updateItem(...args);
  }

  transitionItem(
    ...args: Parameters<WorkboardItemTransitionsDal["transitionItem"]>
  ): ReturnType<WorkboardItemTransitionsDal["transitionItem"]> {
    return this.itemTransitions.transitionItem(...args);
  }

  appendEvent(
    ...args: Parameters<WorkboardItemRelationsDal["appendEvent"]>
  ): ReturnType<WorkboardItemRelationsDal["appendEvent"]> {
    return this.itemRelations.appendEvent(...args);
  }

  listEvents(
    ...args: Parameters<WorkboardItemRelationsDal["listEvents"]>
  ): ReturnType<WorkboardItemRelationsDal["listEvents"]> {
    return this.itemRelations.listEvents(...args);
  }

  getStateKv(
    ...args: Parameters<WorkboardStateKvDal["getStateKv"]>
  ): ReturnType<WorkboardStateKvDal["getStateKv"]> {
    return this.stateKv.getStateKv(...args);
  }

  listStateKv(
    ...args: Parameters<WorkboardStateKvDal["listStateKv"]>
  ): ReturnType<WorkboardStateKvDal["listStateKv"]> {
    return this.stateKv.listStateKv(...args);
  }

  setStateKv(
    ...args: Parameters<WorkboardStateKvDal["setStateKv"]>
  ): ReturnType<WorkboardStateKvDal["setStateKv"]> {
    return this.stateKv.setStateKv(...args);
  }

  async createArtifact(params: {
    scope: WorkScope;
    artifact: {
      work_item_id?: string;
      kind: WorkArtifactKind;
      title: string;
      body_md?: string;
      refs?: string[];
      confidence?: number;
      created_by_run_id?: string;
      created_by_subagent_id?: string;
      provenance_json?: unknown;
    };
    artifactId?: string;
    createdAtIso?: string;
  }): Promise<WorkArtifact> {
    const artifactId = params.artifactId?.trim() || randomUUID();
    const createdAtIso = params.createdAtIso ?? new Date().toISOString();

    if (params.artifact.work_item_id) {
      const item = await this.getItem({
        scope: params.scope,
        work_item_id: params.artifact.work_item_id,
      });
      if (!item) {
        throw new Error("work_item_id is outside scope");
      }
    }

    if (params.artifact.created_by_subagent_id) {
      const subagent = await this.getSubagent({
        scope: params.scope,
        subagent_id: params.artifact.created_by_subagent_id,
      });
      if (!subagent) {
        throw new Error("created_by_subagent_id is outside scope");
      }
    }

    const row = await this.db.get<DalHelpers.RawWorkArtifactRow>(
      `INSERT INTO work_artifacts (
         artifact_id,
         tenant_id,
         agent_id,
         workspace_id,
         work_item_id,
         kind,
         title,
         body_md,
         refs_json,
         confidence,
         created_at,
         created_by_run_id,
         created_by_subagent_id,
         provenance_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        artifactId,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.artifact.work_item_id ?? null,
        params.artifact.kind,
        params.artifact.title,
        params.artifact.body_md ?? null,
        JSON.stringify(params.artifact.refs ?? []),
        params.artifact.confidence ?? null,
        createdAtIso,
        params.artifact.created_by_run_id ?? null,
        params.artifact.created_by_subagent_id ?? null,
        params.artifact.provenance_json === undefined
          ? null
          : JSON.stringify(params.artifact.provenance_json),
      ],
    );
    if (!row) {
      throw new Error("work artifact insert failed");
    }
    return dalHelpers.toWorkArtifact(row);
  }

  async listArtifacts(params: {
    scope: WorkScope;
    work_item_id?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ artifacts: WorkArtifact[]; next_cursor?: string }> {
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

    if (params.cursor) {
      const cursor = dalHelpers.decodeCursor(params.cursor);
      where.push("(created_at < ? OR (created_at = ? AND artifact_id < ?))");
      values.push(cursor.sort, cursor.sort, cursor.id);
    }

    const limit = Math.max(1, Math.min(200, params.limit ?? 50));
    values.push(limit);

    const rows = await this.db.all<DalHelpers.RawWorkArtifactRow>(
      `SELECT *
       FROM work_artifacts
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, artifact_id DESC
       LIMIT ?`,
      values,
    );

    const artifacts = rows.map(dalHelpers.toWorkArtifact);
    const last = artifacts.at(-1);
    const next_cursor =
      artifacts.length === limit && last
        ? dalHelpers.encodeCursor({ sort: last.created_at, id: last.artifact_id })
        : undefined;

    return { artifacts, next_cursor };
  }

  async getArtifact(params: {
    scope: WorkScope;
    artifact_id: string;
  }): Promise<WorkArtifact | undefined> {
    const row = await this.db.get<DalHelpers.RawWorkArtifactRow>(
      `SELECT *
       FROM work_artifacts
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND artifact_id = ?`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.artifact_id,
      ],
    );
    return row ? dalHelpers.toWorkArtifact(row) : undefined;
  }

  async createDecision(params: {
    scope: WorkScope;
    decision: {
      work_item_id?: string;
      question: string;
      chosen: string;
      alternatives?: string[];
      rationale_md: string;
      input_artifact_ids?: string[];
      created_by_run_id?: string;
      created_by_subagent_id?: string;
    };
    decisionId?: string;
    createdAtIso?: string;
  }): Promise<DecisionRecord> {
    const decisionId = params.decisionId?.trim() || randomUUID();
    const createdAtIso = params.createdAtIso ?? new Date().toISOString();

    if (params.decision.work_item_id) {
      const item = await this.getItem({
        scope: params.scope,
        work_item_id: params.decision.work_item_id,
      });
      if (!item) {
        throw new Error("work_item_id is outside scope");
      }
    }

    if (params.decision.created_by_subagent_id) {
      const subagent = await this.getSubagent({
        scope: params.scope,
        subagent_id: params.decision.created_by_subagent_id,
      });
      if (!subagent) {
        throw new Error("created_by_subagent_id is outside scope");
      }
    }

    const row = await this.db.get<DalHelpers.RawDecisionRow>(
      `INSERT INTO work_decisions (
         decision_id,
         tenant_id,
         agent_id,
         workspace_id,
         work_item_id,
         question,
         chosen,
         alternatives_json,
         rationale_md,
         input_artifact_ids_json,
         created_at,
         created_by_run_id,
         created_by_subagent_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        decisionId,
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.decision.work_item_id ?? null,
        params.decision.question,
        params.decision.chosen,
        JSON.stringify(params.decision.alternatives ?? []),
        params.decision.rationale_md,
        JSON.stringify(params.decision.input_artifact_ids ?? []),
        createdAtIso,
        params.decision.created_by_run_id ?? null,
        params.decision.created_by_subagent_id ?? null,
      ],
    );
    if (!row) {
      throw new Error("work decision insert failed");
    }
    return dalHelpers.toDecisionRecord(row);
  }

  async getDecision(params: {
    scope: WorkScope;
    decision_id: string;
  }): Promise<DecisionRecord | undefined> {
    const row = await this.db.get<DalHelpers.RawDecisionRow>(
      `SELECT *
       FROM work_decisions
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND decision_id = ?`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.decision_id,
      ],
    );
    return row ? dalHelpers.toDecisionRecord(row) : undefined;
  }

  async listDecisions(params: {
    scope: WorkScope;
    work_item_id?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ decisions: DecisionRecord[]; next_cursor?: string }> {
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

    if (params.cursor) {
      const cursor = dalHelpers.decodeCursor(params.cursor);
      where.push("(created_at < ? OR (created_at = ? AND decision_id < ?))");
      values.push(cursor.sort, cursor.sort, cursor.id);
    }

    const limit = Math.max(1, Math.min(200, params.limit ?? 50));
    values.push(limit);

    const rows = await this.db.all<DalHelpers.RawDecisionRow>(
      `SELECT *
       FROM work_decisions
       WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, decision_id DESC
       LIMIT ?`,
      values,
    );
    const decisions = rows.map(dalHelpers.toDecisionRecord);
    const last = decisions.at(-1);
    const next_cursor =
      decisions.length === limit && last
        ? dalHelpers.encodeCursor({ sort: last.created_at, id: last.decision_id })
        : undefined;

    return { decisions, next_cursor };
  }

  createLink(
    ...args: Parameters<WorkboardItemRelationsDal["createLink"]>
  ): ReturnType<WorkboardItemRelationsDal["createLink"]> {
    return this.itemRelations.createLink(...args);
  }

  listLinks(
    ...args: Parameters<WorkboardItemRelationsDal["listLinks"]>
  ): ReturnType<WorkboardItemRelationsDal["listLinks"]> {
    return this.itemRelations.listLinks(...args);
  }

  createTask(
    ...args: Parameters<WorkboardTasksDal["createTask"]>
  ): ReturnType<WorkboardTasksDal["createTask"]> {
    return this.tasks.createTask(...args);
  }

  listTasks(
    ...args: Parameters<WorkboardTasksDal["listTasks"]>
  ): ReturnType<WorkboardTasksDal["listTasks"]> {
    return this.tasks.listTasks(...args);
  }

  updateTask(
    ...args: Parameters<WorkboardTaskUpdatesDal["updateTask"]>
  ): ReturnType<WorkboardTaskUpdatesDal["updateTask"]> {
    return this.taskUpdates.updateTask(...args);
  }

  leaseRunnableTasks(
    ...args: Parameters<WorkboardTaskLeasingDal["leaseRunnableTasks"]>
  ): ReturnType<WorkboardTaskLeasingDal["leaseRunnableTasks"]> {
    return this.taskLeasing.leaseRunnableTasks(...args);
  }

  createSubagent(
    ...args: Parameters<WorkboardSubagentDal["createSubagent"]>
  ): ReturnType<WorkboardSubagentDal["createSubagent"]> {
    return this.subagents.createSubagent(...args);
  }

  heartbeatSubagent(
    ...args: Parameters<WorkboardSubagentDal["heartbeatSubagent"]>
  ): ReturnType<WorkboardSubagentDal["heartbeatSubagent"]> {
    return this.subagents.heartbeatSubagent(...args);
  }

  getSubagent(
    ...args: Parameters<WorkboardSubagentDal["getSubagent"]>
  ): ReturnType<WorkboardSubagentDal["getSubagent"]> {
    return this.subagents.getSubagent(...args);
  }

  listSubagents(
    ...args: Parameters<WorkboardSubagentDal["listSubagents"]>
  ): ReturnType<WorkboardSubagentDal["listSubagents"]> {
    return this.subagents.listSubagents(...args);
  }

  closeSubagent(
    ...args: Parameters<WorkboardSubagentDal["closeSubagent"]>
  ): ReturnType<WorkboardSubagentDal["closeSubagent"]> {
    return this.subagents.closeSubagent(...args);
  }

  markSubagentClosed(
    ...args: Parameters<WorkboardSubagentDal["markSubagentClosed"]>
  ): ReturnType<WorkboardSubagentDal["markSubagentClosed"]> {
    return this.subagents.markSubagentClosed(...args);
  }

  markSubagentFailed(
    ...args: Parameters<WorkboardSubagentDal["markSubagentFailed"]>
  ): ReturnType<WorkboardSubagentDal["markSubagentFailed"]> {
    return this.subagents.markSubagentFailed(...args);
  }

  createSignal(
    ...args: Parameters<WorkboardSignalsDal["createSignal"]>
  ): ReturnType<WorkboardSignalsDal["createSignal"]> {
    return this.signals.createSignal(...args);
  }

  updateSignal(
    ...args: Parameters<WorkboardSignalsDal["updateSignal"]>
  ): ReturnType<WorkboardSignalsDal["updateSignal"]> {
    return this.signals.updateSignal(...args);
  }

  markSignalFired(
    ...args: Parameters<WorkboardSignalsDal["markSignalFired"]>
  ): ReturnType<WorkboardSignalsDal["markSignalFired"]> {
    return this.signals.markSignalFired(...args);
  }

  getSignal(
    ...args: Parameters<WorkboardSignalsDal["getSignal"]>
  ): ReturnType<WorkboardSignalsDal["getSignal"]> {
    return this.signals.getSignal(...args);
  }

  listSignals(
    ...args: Parameters<WorkboardSignalsDal["listSignals"]>
  ): ReturnType<WorkboardSignalsDal["listSignals"]> {
    return this.signals.listSignals(...args);
  }

  upsertScopeActivity(
    ...args: Parameters<WorkboardSignalsDal["upsertScopeActivity"]>
  ): ReturnType<WorkboardSignalsDal["upsertScopeActivity"]> {
    return this.signals.upsertScopeActivity(...args);
  }

  getScopeActivity(
    ...args: Parameters<WorkboardSignalsDal["getScopeActivity"]>
  ): ReturnType<WorkboardSignalsDal["getScopeActivity"]> {
    return this.signals.getScopeActivity(...args);
  }
}
