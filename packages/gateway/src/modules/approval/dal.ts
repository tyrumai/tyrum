import type { ReviewEntry as ReviewEntryT } from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import { ReviewEntryDal, type ReviewEntryRow, type ReviewerKind } from "../review/dal.js";
import type {
  ApprovalRow,
  CreateApprovalParams,
  RawApprovalRow,
  ResolveWithEngineActionInput,
  TransitionWithReviewInput,
} from "./dal-types.js";
import { ApprovalEngineActionDal } from "./engine-action-dal.js";
import { expireStaleApprovals, toApprovalRow } from "./dal-support.js";
import { buildSqlPlaceholders } from "../../utils/sql.js";
import {
  type ApprovalStatus,
  approvalNeedsHumanDecision,
  isApprovalBlockedStatus,
  isApprovalTerminalStatus,
  normalizeApprovalStatus,
} from "./status.js";

export type { ApprovalRow, CreateApprovalParams, RawApprovalRow } from "./dal-types.js";
export type { ApprovalStatus } from "./status.js";
export { approvalNeedsHumanDecision, isApprovalBlockedStatus, isApprovalTerminalStatus };

const APPROVAL_SELECT_SQL = `tenant_id,
       approval_id,
       approval_key,
       agent_id,
       workspace_id,
       kind,
       status,
       prompt,
       motivation,
       context_json,
       created_at,
       expires_at,
       latest_review_id,
       conversation_id AS conversation_id,
       plan_id,
       turn_id AS turn_id,
       turn_item_id,
       workflow_run_step_id,
       step_id,
       attempt_id,
       work_item_id,
       work_item_task_id,
       resume_token`;

function toReviewEntryContract(review: ReviewEntryRow): ReviewEntryT {
  const { tenant_id: _tenantId, ...contract } = review;
  return contract;
}

export class ApprovalDal {
  constructor(
    private readonly db: SqlDb,
    private readonly inTransaction = false,
  ) {}

  private createTxDal(tx: SqlDb): ApprovalDal {
    return new ApprovalDal(tx, true);
  }

  private get reviewEntries(): ReviewEntryDal {
    return new ReviewEntryDal(this.db);
  }

  private async hydrateMany(
    rows: RawApprovalRow[],
    options?: { includeReviews?: boolean },
  ): Promise<ApprovalRow[]> {
    if (rows.length === 0) {
      return [];
    }

    const latestReviewIds = [
      ...new Set(rows.map((row) => row.latest_review_id?.trim() ?? "").filter(Boolean)),
    ];
    const [latestReviews, reviews] = await Promise.all([
      this.reviewEntries.getByIds({
        tenantId: rows[0]!.tenant_id,
        reviewIds: latestReviewIds,
      }),
      options?.includeReviews
        ? this.reviewEntries.listByTargets({
            tenantId: rows[0]!.tenant_id,
            targetType: "approval",
            targetIds: rows.map((row) => row.approval_id),
          })
        : Promise.resolve([]),
    ]);

    const latestReviewById = new Map(
      latestReviews.map((review) => [review.review_id, toReviewEntryContract(review)]),
    );
    const reviewsByApprovalId = new Map<string, ReviewEntryT[]>();
    for (const review of reviews) {
      const contract = toReviewEntryContract(review);
      const current = reviewsByApprovalId.get(review.target_id);
      if (current) {
        current.push(contract);
      } else {
        reviewsByApprovalId.set(review.target_id, [contract]);
      }
    }

    return rows.map((raw) =>
      toApprovalRow({
        raw,
        latestReview: raw.latest_review_id
          ? (latestReviewById.get(raw.latest_review_id) ?? null)
          : null,
        reviews: options?.includeReviews
          ? (reviewsByApprovalId.get(raw.approval_id) ?? [])
          : undefined,
      }),
    );
  }

  private async hydrate(
    raw: RawApprovalRow,
    options?: { includeReviews?: boolean },
  ): Promise<ApprovalRow> {
    const [hydrated] = await this.hydrateMany([raw], options);
    if (!hydrated) {
      throw new Error(`approval ${raw.approval_id} disappeared during hydration`);
    }
    return hydrated;
  }

  private async getRawById(input: {
    tenantId: string;
    approvalId: string;
  }): Promise<RawApprovalRow | undefined> {
    return await this.db.get<RawApprovalRow>(
      `SELECT ${APPROVAL_SELECT_SQL}
       FROM approvals
       WHERE tenant_id = ? AND approval_id = ?`,
      [input.tenantId, input.approvalId],
    );
  }

  async create(params: CreateApprovalParams): Promise<ApprovalRow> {
    const tenantId = params.tenantId.trim();
    const agentId = params.agentId.trim();
    const workspaceId = params.workspaceId.trim();
    const approvalKey = params.approvalKey.trim();
    const prompt = params.prompt.trim();
    const kind = params.kind ?? "policy";
    const motivation = (params.motivation ?? prompt).trim();
    if (!tenantId) throw new Error("tenantId is required");
    if (!agentId) throw new Error("agentId is required");
    if (!workspaceId) throw new Error("workspaceId is required");
    if (!approvalKey) throw new Error("approvalKey is required");
    if (!prompt) throw new Error("prompt is required");
    if (!motivation) throw new Error("motivation is required");

    const inserted = await this.db.get<RawApprovalRow>(
      `INSERT INTO approvals (
         tenant_id,
         approval_id,
         approval_key,
         agent_id,
         workspace_id,
         kind,
         status,
         prompt,
         motivation,
         context_json,
         created_at,
         expires_at,
         latest_review_id,
         conversation_id,
         plan_id,
         turn_id,
         turn_item_id,
         workflow_run_step_id,
         step_id,
         attempt_id,
         work_item_id,
         work_item_task_id,
         resume_token
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, approval_key) DO NOTHING
       RETURNING *`,
      [
        tenantId,
        randomUUID(),
        approvalKey,
        agentId,
        workspaceId,
        kind,
        params.status ?? "queued",
        prompt,
        motivation,
        JSON.stringify(params.context ?? {}),
        new Date().toISOString(),
        params.expiresAt ?? null,
        null,
        params.conversationId ?? null,
        params.planId ?? null,
        params.turnId ?? null,
        params.turnItemId ?? null,
        params.workflowRunStepId ?? null,
        params.stepId ?? null,
        params.attemptId ?? null,
        params.workItemId ?? null,
        params.workItemTaskId ?? null,
        params.resumeToken ?? null,
      ],
    );
    if (inserted) {
      return await this.hydrate(inserted);
    }
    const existing = await this.getByKey({ tenantId, approvalKey });
    if (!existing) {
      throw new Error("failed to create approval");
    }
    return existing;
  }

  async getById(input: {
    tenantId: string;
    approvalId: string;
    includeReviews?: boolean;
  }): Promise<ApprovalRow | undefined> {
    const row = await this.getRawById(input);
    return row ? await this.hydrate(row, { includeReviews: input.includeReviews }) : undefined;
  }

  async getByIds(input: {
    tenantId: string;
    approvalIds: readonly string[];
    includeReviews?: boolean;
  }): Promise<ApprovalRow[]> {
    if (input.approvalIds.length === 0) {
      return [];
    }

    const approvalIds = [
      ...new Set(input.approvalIds.map((approvalId) => approvalId.trim())),
    ].filter((approvalId) => approvalId.length > 0);
    if (approvalIds.length === 0) {
      return [];
    }

    const rows = await this.db.all<RawApprovalRow>(
      `SELECT ${APPROVAL_SELECT_SQL}
       FROM approvals
       WHERE tenant_id = ?
         AND approval_id IN (${buildSqlPlaceholders(approvalIds.length)})
       ORDER BY created_at ASC, approval_id ASC`,
      [input.tenantId.trim(), ...approvalIds],
    );
    return await this.hydrateMany(rows, { includeReviews: input.includeReviews });
  }

  async getByKey(input: {
    tenantId: string;
    approvalKey: string;
  }): Promise<ApprovalRow | undefined> {
    const row = await this.db.get<RawApprovalRow>(
      `SELECT ${APPROVAL_SELECT_SQL}
       FROM approvals
       WHERE tenant_id = ? AND approval_key = ?`,
      [input.tenantId.trim(), input.approvalKey.trim()],
    );
    return row ? await this.hydrate(row) : undefined;
  }

  async getByStatus(input: {
    tenantId: string;
    status: ApprovalStatus;
    newestFirst?: boolean;
  }): Promise<ApprovalRow[]> {
    const orderBy = input.newestFirst
      ? "ORDER BY created_at DESC, approval_id DESC"
      : "ORDER BY created_at ASC, approval_id ASC";
    const rows = await this.db.all<RawApprovalRow>(
      `SELECT ${APPROVAL_SELECT_SQL}
       FROM approvals
       WHERE tenant_id = ? AND status = ?
       ${orderBy}`,
      [input.tenantId.trim(), input.status],
    );
    return await this.hydrateMany(rows);
  }

  async getPending(input: { tenantId: string }): Promise<ApprovalRow[]> {
    const rows = await this.db.all<RawApprovalRow>(
      `SELECT ${APPROVAL_SELECT_SQL}
       FROM approvals
       WHERE tenant_id = ?
         AND status IN ('queued', 'awaiting_human')
       ORDER BY created_at ASC, approval_id ASC`,
      [input.tenantId.trim()],
    );
    return await this.hydrateMany(rows);
  }

  async listBlocked(input: { tenantId: string }): Promise<ApprovalRow[]> {
    const rows = await this.db.all<RawApprovalRow>(
      `SELECT ${APPROVAL_SELECT_SQL}
       FROM approvals
       WHERE tenant_id = ?
         AND status IN ('queued', 'reviewing', 'awaiting_human')
       ORDER BY created_at DESC`,
      [input.tenantId.trim()],
    );
    return await this.hydrateMany(rows);
  }

  async getByResumeToken(input: {
    tenantId: string;
    resumeToken: string;
    includeReviews?: boolean;
  }): Promise<ApprovalRow | undefined> {
    const token = input.resumeToken.trim();
    if (!token) return undefined;
    const row = await this.db.get<RawApprovalRow>(
      `SELECT ${APPROVAL_SELECT_SQL}
       FROM approvals
       WHERE tenant_id = ?
         AND resume_token = ?`,
      [input.tenantId.trim(), token],
    );
    return row ? await this.hydrate(row, { includeReviews: input.includeReviews }) : undefined;
  }

  async transitionWithReview(
    input: TransitionWithReviewInput,
  ): Promise<{ approval: ApprovalRow; transitioned: boolean } | undefined> {
    if (this.inTransaction) {
      return await this.transitionWithReviewTx(this.db, input);
    }

    return await this.db.transaction(async (tx) => {
      const approvalDal = tx === this.db ? this : this.createTxDal(tx);
      return await approvalDal.transitionWithReviewTx(tx, input);
    });
  }

  private async transitionWithReviewTx(
    tx: SqlDb,
    input: TransitionWithReviewInput,
  ): Promise<{ approval: ApprovalRow; transitioned: boolean } | undefined> {
    const approvalDal = tx === this.db ? this : this.createTxDal(tx);
    const reviewDal = new ReviewEntryDal(tx);
    const current = await approvalDal.getRawById({
      tenantId: input.tenantId,
      approvalId: input.approvalId,
    });
    if (!current) return undefined;

    const currentStatus = normalizeApprovalStatus(current.status);
    if (
      input.allowedCurrentStatuses &&
      !input.allowedCurrentStatuses.includes(currentStatus) &&
      !isApprovalTerminalStatus(currentStatus)
    ) {
      return {
        approval: await approvalDal.hydrate(current, { includeReviews: input.includeReviews }),
        transitioned: false,
      };
    }
    if (isApprovalTerminalStatus(currentStatus)) {
      return {
        approval: await approvalDal.hydrate(current, { includeReviews: input.includeReviews }),
        transitioned: false,
      };
    }

    const review = await reviewDal.create({
      tenantId: input.tenantId,
      reviewId: randomUUID(),
      targetType: "approval",
      targetId: input.approvalId,
      reviewerKind: input.reviewerKind,
      reviewerId: input.reviewerId,
      state: input.reviewState,
      reason: input.reason,
      riskLevel: input.riskLevel ?? null,
      riskScore: input.riskScore ?? null,
      evidence: input.evidence,
      decisionPayload: input.decisionPayload,
      startedAt: input.reviewState === "running" ? new Date().toISOString() : null,
      completedAt:
        input.reviewState === "running" || input.reviewState === "queued"
          ? null
          : new Date().toISOString(),
    });

    const updated = await tx.run(
      `UPDATE approvals
       SET status = ?,
           latest_review_id = ?
       WHERE tenant_id = ?
         AND approval_id = ?
         AND status = ?`,
      [input.status, review.review_id, input.tenantId, input.approvalId, currentStatus],
    );
    if (updated.changes === 0) {
      const deletedReview = await reviewDal.deleteById({
        tenantId: input.tenantId,
        reviewId: review.review_id,
      });
      if (!deletedReview) {
        throw new Error(
          `failed to discard review ${review.review_id} for approval ${input.approvalId}`,
        );
      }

      const currentApproval = await approvalDal.getById({
        tenantId: input.tenantId,
        approvalId: input.approvalId,
        includeReviews: input.includeReviews,
      });
      if (!currentApproval) {
        throw new Error(`approval ${input.approvalId} disappeared after lost transition race`);
      }
      return { approval: currentApproval, transitioned: false };
    }
    if (updated.changes !== 1) {
      throw new Error(`failed to update approval ${input.approvalId}`);
    }

    const next = await approvalDal.getById({
      tenantId: input.tenantId,
      approvalId: input.approvalId,
      includeReviews: input.includeReviews,
    });
    if (!next) {
      throw new Error(`approval ${input.approvalId} disappeared after update`);
    }
    return { approval: next, transitioned: true };
  }

  async resolveWithEngineAction(
    input: ResolveWithEngineActionInput,
  ): Promise<{ approval: ApprovalRow; transitioned: boolean } | undefined> {
    if (this.inTransaction) {
      return await this.resolveWithEngineActionTx(this.db, input);
    }

    return await this.db.transaction(async (tx) => {
      const approvalDal = tx === this.db ? this : this.createTxDal(tx);
      return await approvalDal.resolveWithEngineActionTx(tx, input);
    });
  }

  private async resolveWithEngineActionTx(
    tx: SqlDb,
    input: ResolveWithEngineActionInput,
  ): Promise<{ approval: ApprovalRow; transitioned: boolean } | undefined> {
    const approvalDal = tx === this.db ? this : this.createTxDal(tx);
    const actionDal = new ApprovalEngineActionDal(tx);
    const transitioned = await approvalDal.transitionWithReviewTx(tx, {
      tenantId: input.tenantId,
      approvalId: input.approvalId,
      status: input.decision === "approved" ? "approved" : "denied",
      reviewerKind: input.reviewerKind ?? "human",
      reviewerId: input.reviewerId,
      reviewState: input.decision === "approved" ? "approved" : "denied",
      reason: input.reason,
      decisionPayload: input.decisionPayload ?? input.resolvedBy,
      allowedCurrentStatuses: input.allowedCurrentStatuses ?? ["awaiting_human"],
    });
    if (!transitioned) return undefined;
    if (transitioned.transitioned) {
      await actionDal.enqueueForResolvedApproval({
        tenantId: input.tenantId,
        approval: transitioned.approval,
        reason: input.reason,
      });
    }
    return transitioned;
  }

  async respond(input: {
    tenantId: string;
    approvalId: string;
    decision: "approved" | "denied";
    reason?: string;
    reviewerKind?: ReviewerKind;
    reviewerId?: string | null;
  }): Promise<ApprovalRow | undefined> {
    const resolved = await this.resolveWithEngineAction({
      ...input,
      allowedCurrentStatuses: ["queued", "awaiting_human"],
    });
    return resolved?.approval;
  }

  async expireById(input: {
    tenantId: string;
    approvalId: string;
  }): Promise<ApprovalRow | undefined> {
    const transitioned = await this.transitionWithReview({
      tenantId: input.tenantId,
      approvalId: input.approvalId,
      status: "expired",
      reviewerKind: "system",
      reviewState: "expired",
      reason: "approval timed out",
      allowedCurrentStatuses: ["queued", "reviewing", "awaiting_human"],
    });
    return transitioned?.approval;
  }

  async expireStale(input: { tenantId: string; nowIso?: string }): Promise<number> {
    const nowIso = input.nowIso ?? new Date().toISOString();
    return await this.db.transaction(async (tx) =>
      expireStaleApprovals(tx, { tenantId: input.tenantId, nowIso }),
    );
  }
}
