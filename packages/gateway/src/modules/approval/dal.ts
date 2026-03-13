import type { ApprovalKind as ApprovalKindT, ReviewEntry as ReviewEntryT } from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import {
  type CreateReviewEntryParams,
  ReviewEntryDal,
  type ReviewEntryRow,
  type ReviewerKind,
} from "../review/dal.js";
import { ApprovalEngineActionDal } from "./engine-action-dal.js";
import { expireStaleApprovals, toApprovalRow } from "./dal-support.js";
import {
  type ApprovalStatus,
  approvalNeedsHumanDecision,
  isApprovalBlockedStatus,
  isApprovalTerminalStatus,
  normalizeApprovalStatus,
} from "./status.js";

export type { ApprovalStatus } from "./status.js";
export { approvalNeedsHumanDecision, isApprovalBlockedStatus, isApprovalTerminalStatus };

export interface ApprovalRow {
  tenant_id: string;
  approval_id: string;
  approval_key: string;
  agent_id: string;
  workspace_id: string;
  kind: ApprovalKindT;
  status: ApprovalStatus;
  prompt: string;
  motivation: string;
  context: unknown;
  created_at: string;
  expires_at: string | null;
  latest_review: ReviewEntryT | null;
  reviews?: ReviewEntryT[];
  session_id: string | null;
  plan_id: string | null;
  run_id: string | null;
  step_id: string | null;
  attempt_id: string | null;
  work_item_id: string | null;
  work_item_task_id: string | null;
  resume_token: string | null;
}

export interface RawApprovalRow {
  tenant_id: string;
  approval_id: string;
  approval_key: string;
  agent_id: string;
  workspace_id: string;
  kind: string;
  status: string;
  prompt: string;
  motivation: string;
  context_json: string;
  created_at: string | Date;
  expires_at: string | Date | null;
  latest_review_id: string | null;
  session_id: string | null;
  plan_id: string | null;
  run_id: string | null;
  step_id: string | null;
  attempt_id: string | null;
  work_item_id: string | null;
  work_item_task_id: string | null;
  resume_token: string | null;
}

export interface CreateApprovalParams {
  tenantId: string;
  agentId: string;
  workspaceId: string;
  approvalKey: string;
  prompt: string;
  motivation: string;
  kind: ApprovalKindT;
  status?: ApprovalStatus;
  context?: unknown;
  expiresAt?: string | null;
  sessionId?: string | null;
  planId?: string | null;
  runId?: string | null;
  stepId?: string | null;
  attemptId?: string | null;
  workItemId?: string | null;
  workItemTaskId?: string | null;
  resumeToken?: string | null;
}

function toReviewEntryContract(review: ReviewEntryRow): ReviewEntryT {
  const { tenant_id: _tenantId, ...contract } = review;
  return contract;
}

export class ApprovalDal {
  constructor(private readonly db: SqlDb) {}

  private createTxDal(tx: SqlDb): ApprovalDal {
    return new ApprovalDal(tx);
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
      `SELECT *
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
         session_id,
         plan_id,
         run_id,
         step_id,
         attempt_id,
         work_item_id,
         work_item_task_id,
         resume_token
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        params.sessionId ?? null,
        params.planId ?? null,
        params.runId ?? null,
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

  async getByKey(input: {
    tenantId: string;
    approvalKey: string;
  }): Promise<ApprovalRow | undefined> {
    const row = await this.db.get<RawApprovalRow>(
      `SELECT *
       FROM approvals
       WHERE tenant_id = ? AND approval_key = ?`,
      [input.tenantId.trim(), input.approvalKey.trim()],
    );
    return row ? await this.hydrate(row) : undefined;
  }

  async getByStatus(input: { tenantId: string; status: ApprovalStatus }): Promise<ApprovalRow[]> {
    const rows = await this.db.all<RawApprovalRow>(
      `SELECT *
       FROM approvals
       WHERE tenant_id = ? AND status = ?
       ORDER BY created_at ASC, approval_id ASC`,
      [input.tenantId.trim(), input.status],
    );
    return await this.hydrateMany(rows);
  }

  async getPending(input: { tenantId: string }): Promise<ApprovalRow[]> {
    const rows = await this.db.all<RawApprovalRow>(
      `SELECT *
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
      `SELECT *
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
      `SELECT *
       FROM approvals
       WHERE tenant_id = ?
         AND resume_token = ?`,
      [input.tenantId.trim(), token],
    );
    return row ? await this.hydrate(row, { includeReviews: input.includeReviews }) : undefined;
  }

  async transitionWithReview(input: {
    tenantId: string;
    approvalId: string;
    status: ApprovalStatus;
    reviewerKind: ReviewerKind;
    reviewerId?: string | null;
    reviewState: CreateReviewEntryParams["state"];
    reason?: string | null;
    riskLevel?: CreateReviewEntryParams["riskLevel"];
    riskScore?: CreateReviewEntryParams["riskScore"];
    evidence?: unknown;
    decisionPayload?: unknown;
    allowedCurrentStatuses?: ApprovalStatus[];
    includeReviews?: boolean;
  }): Promise<{ approval: ApprovalRow; transitioned: boolean } | undefined> {
    return await this.db.transaction(async (tx) => {
      const approvalDal = tx === this.db ? this : this.createTxDal(tx);
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

      const review = await new ReviewEntryDal(tx).create({
        tenantId: input.tenantId,
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
         WHERE tenant_id = ? AND approval_id = ?`,
        [input.status, review.review_id, input.tenantId, input.approvalId],
      );
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
    });
  }

  async resolveWithEngineAction(input: {
    tenantId: string;
    approvalId: string;
    decision: "approved" | "denied";
    reason?: string;
    reviewerKind?: ReviewerKind;
    reviewerId?: string | null;
    allowedCurrentStatuses?: ApprovalStatus[];
    resolvedBy?: unknown;
    decisionPayload?: unknown;
  }): Promise<{ approval: ApprovalRow; transitioned: boolean } | undefined> {
    return await this.db.transaction(async (tx) => {
      const approvalDal = tx === this.db ? this : this.createTxDal(tx);
      const actionDal = new ApprovalEngineActionDal(tx);
      const transitioned = await approvalDal.transitionWithReview({
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
    });
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
