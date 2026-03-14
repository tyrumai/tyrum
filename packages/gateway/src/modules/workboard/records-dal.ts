import { randomUUID } from "node:crypto";
import type {
  DecisionRecord,
  SubagentDescriptor,
  WorkArtifact,
  WorkArtifactKind,
  WorkScope,
} from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import type { GetItemFn } from "./dal-deps.js";
import * as dalHelpers from "./dal-helpers.js";
import type * as DalHelpers from "./dal-helpers.js";

type GetSubagentFn = (params: {
  scope: WorkScope;
  subagent_id: string;
}) => Promise<SubagentDescriptor | undefined>;

export class WorkboardRecordsDal {
  constructor(
    private readonly deps: {
      db: SqlDb;
      getItem: GetItemFn;
      getSubagent: GetSubagentFn;
    },
  ) {}

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
      const item = await this.deps.getItem({
        scope: params.scope,
        work_item_id: params.artifact.work_item_id,
      });
      if (!item) {
        throw new Error("work_item_id is outside scope");
      }
    }

    if (params.artifact.created_by_subagent_id) {
      const subagent = await this.deps.getSubagent({
        scope: params.scope,
        subagent_id: params.artifact.created_by_subagent_id,
      });
      if (!subagent) {
        throw new Error("created_by_subagent_id is outside scope");
      }
    }

    const row = await this.deps.db.get<DalHelpers.RawWorkArtifactRow>(
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

    const rows = await this.deps.db.all<DalHelpers.RawWorkArtifactRow>(
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
    const row = await this.deps.db.get<DalHelpers.RawWorkArtifactRow>(
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

  async deleteArtifact(params: {
    scope: WorkScope;
    artifact_id: string;
  }): Promise<WorkArtifact | undefined> {
    const row = await this.deps.db.get<DalHelpers.RawWorkArtifactRow>(
      `DELETE FROM work_artifacts
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND artifact_id = ?
       RETURNING *`,
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
      const item = await this.deps.getItem({
        scope: params.scope,
        work_item_id: params.decision.work_item_id,
      });
      if (!item) {
        throw new Error("work_item_id is outside scope");
      }
    }

    if (params.decision.created_by_subagent_id) {
      const subagent = await this.deps.getSubagent({
        scope: params.scope,
        subagent_id: params.decision.created_by_subagent_id,
      });
      if (!subagent) {
        throw new Error("created_by_subagent_id is outside scope");
      }
    }

    const row = await this.deps.db.get<DalHelpers.RawDecisionRow>(
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
    const row = await this.deps.db.get<DalHelpers.RawDecisionRow>(
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

    const rows = await this.deps.db.all<DalHelpers.RawDecisionRow>(
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

  async deleteDecision(params: {
    scope: WorkScope;
    decision_id: string;
  }): Promise<DecisionRecord | undefined> {
    const row = await this.deps.db.get<DalHelpers.RawDecisionRow>(
      `DELETE FROM work_decisions
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND decision_id = ?
       RETURNING *`,
      [
        params.scope.tenant_id,
        params.scope.agent_id,
        params.scope.workspace_id,
        params.decision_id,
      ],
    );
    return row ? dalHelpers.toDecisionRecord(row) : undefined;
  }
}
