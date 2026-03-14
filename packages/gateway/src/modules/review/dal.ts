import type {
  ReviewEntry as ReviewEntryT,
  ReviewRiskLevel as ReviewRiskLevelT,
  ReviewState as ReviewStateT,
  ReviewTargetType as ReviewTargetTypeT,
  ReviewerKind as ReviewerKindT,
} from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";

export type ReviewTargetType = ReviewTargetTypeT;
export type ReviewerKind = ReviewerKindT;
export type ReviewState = ReviewStateT;
export type ReviewRiskLevel = ReviewRiskLevelT;

export interface ReviewEntryRow extends ReviewEntryT {
  tenant_id: string;
}

interface RawReviewEntryRow {
  tenant_id: string;
  review_id: string;
  target_type: string;
  target_id: string;
  reviewer_kind: string;
  reviewer_id: string | null;
  state: string;
  reason: string | null;
  risk_level: string | null;
  risk_score: number | null;
  evidence_json: string | null;
  decision_payload_json: string | null;
  created_at: string | Date;
  started_at: string | Date | null;
  completed_at: string | Date | null;
}

export interface CreateReviewEntryParams {
  tenantId: string;
  reviewId?: string;
  targetType: ReviewTargetType;
  targetId: string | number;
  reviewerKind: ReviewerKind;
  reviewerId?: string | null;
  state: ReviewState;
  reason?: string | null;
  riskLevel?: ReviewRiskLevel | null;
  riskScore?: number | null;
  evidence?: unknown;
  decisionPayload?: unknown;
  createdAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

function parseJsonOrNull(raw: string | null): unknown | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Intentional: review evidence/payload blobs are optional; discard malformed legacy JSON.
    return null;
  }
}

function normalizeString(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTargetId(value: string | number): string {
  return typeof value === "number" ? String(value) : value.trim();
}

function joinPlaceholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function toReviewEntryRow(raw: RawReviewEntryRow): ReviewEntryRow {
  return {
    tenant_id: raw.tenant_id,
    review_id: raw.review_id,
    target_type: raw.target_type as ReviewTargetType,
    target_id: raw.target_id,
    reviewer_kind: raw.reviewer_kind as ReviewerKind,
    reviewer_id: raw.reviewer_id,
    state: raw.state as ReviewState,
    reason: normalizeString(raw.reason),
    risk_level: (normalizeString(raw.risk_level) as ReviewRiskLevel | null) ?? null,
    risk_score: raw.risk_score,
    evidence: parseJsonOrNull(raw.evidence_json),
    decision_payload: parseJsonOrNull(raw.decision_payload_json),
    created_at: normalizeDbDateTime(raw.created_at) ?? new Date().toISOString(),
    started_at: normalizeDbDateTime(raw.started_at),
    completed_at: normalizeDbDateTime(raw.completed_at),
  };
}

export class ReviewEntryDal {
  constructor(private readonly db: SqlDb) {}

  async create(params: CreateReviewEntryParams): Promise<ReviewEntryRow> {
    const tenantId = params.tenantId.trim();
    const reviewId = params.reviewId?.trim() ?? randomUUID();
    const targetId = normalizeTargetId(params.targetId);
    if (!tenantId) throw new Error("tenantId is required");
    if (!reviewId) throw new Error("reviewId is required");
    if (!targetId) throw new Error("targetId is required");

    const createdAt = params.createdAt ?? new Date().toISOString();
    const inserted = await this.db.get<RawReviewEntryRow>(
      `INSERT INTO review_entries (
         tenant_id,
         review_id,
         target_type,
         target_id,
         reviewer_kind,
         reviewer_id,
         state,
         reason,
         risk_level,
         risk_score,
         evidence_json,
         decision_payload_json,
         created_at,
         started_at,
         completed_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        tenantId,
        reviewId,
        params.targetType,
        targetId,
        params.reviewerKind,
        normalizeString(params.reviewerId ?? null),
        params.state,
        normalizeString(params.reason ?? null),
        params.riskLevel ?? null,
        params.riskScore ?? null,
        params.evidence === undefined ? null : JSON.stringify(params.evidence),
        params.decisionPayload === undefined ? null : JSON.stringify(params.decisionPayload),
        createdAt,
        params.startedAt ?? null,
        params.completedAt ?? null,
      ],
    );
    if (!inserted) {
      throw new Error("review entry insert failed");
    }
    return toReviewEntryRow(inserted);
  }

  async deleteById(input: { tenantId: string; reviewId: string }): Promise<boolean> {
    const deleted = await this.db.run(
      `DELETE FROM review_entries
       WHERE tenant_id = ? AND review_id = ?`,
      [input.tenantId.trim(), input.reviewId.trim()],
    );
    return deleted.changes === 1;
  }

  async getById(input: {
    tenantId: string;
    reviewId: string;
  }): Promise<ReviewEntryRow | undefined> {
    const row = await this.db.get<RawReviewEntryRow>(
      `SELECT *
       FROM review_entries
       WHERE tenant_id = ? AND review_id = ?`,
      [input.tenantId.trim(), input.reviewId.trim()],
    );
    return row ? toReviewEntryRow(row) : undefined;
  }

  async getByIds(input: { tenantId: string; reviewIds: string[] }): Promise<ReviewEntryRow[]> {
    const reviewIds = [
      ...new Set(input.reviewIds.map((reviewId) => reviewId.trim()).filter(Boolean)),
    ];
    if (reviewIds.length === 0) {
      return [];
    }

    const rows = await this.db.all<RawReviewEntryRow>(
      `SELECT *
       FROM review_entries
       WHERE tenant_id = ?
         AND review_id IN (${joinPlaceholders(reviewIds.length)})`,
      [input.tenantId.trim(), ...reviewIds],
    );
    return rows.map(toReviewEntryRow);
  }

  async listByTarget(input: {
    tenantId: string;
    targetType: ReviewTargetType;
    targetId: string | number;
  }): Promise<ReviewEntryRow[]> {
    const rows = await this.db.all<RawReviewEntryRow>(
      `SELECT *
       FROM review_entries
       WHERE tenant_id = ?
         AND target_type = ?
         AND target_id = ?
       ORDER BY created_at ASC, review_id ASC`,
      [input.tenantId.trim(), input.targetType, normalizeTargetId(input.targetId)],
    );
    return rows.map(toReviewEntryRow);
  }

  async listByTargets(input: {
    tenantId: string;
    targetType: ReviewTargetType;
    targetIds: Array<string | number>;
  }): Promise<ReviewEntryRow[]> {
    const targetIds = [
      ...new Set(input.targetIds.map((targetId) => normalizeTargetId(targetId)).filter(Boolean)),
    ];
    if (targetIds.length === 0) {
      return [];
    }

    const rows = await this.db.all<RawReviewEntryRow>(
      `SELECT *
       FROM review_entries
       WHERE tenant_id = ?
         AND target_type = ?
         AND target_id IN (${joinPlaceholders(targetIds.length)})
       ORDER BY target_id ASC, created_at ASC, review_id ASC`,
      [input.tenantId.trim(), input.targetType, ...targetIds],
    );
    return rows.map(toReviewEntryRow);
  }
}
