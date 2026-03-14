import type { ApprovalKind as ApprovalKindT, ReviewEntry as ReviewEntryT } from "@tyrum/schemas";
import type { CreateReviewEntryParams, ReviewerKind } from "../review/dal.js";
import type { ApprovalStatus } from "./status.js";

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

export type TransitionWithReviewInput = {
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
};

export type ResolveWithEngineActionInput = {
  tenantId: string;
  approvalId: string;
  decision: "approved" | "denied";
  reason?: string;
  reviewerKind?: ReviewerKind;
  reviewerId?: string | null;
  allowedCurrentStatuses?: ApprovalStatus[];
  resolvedBy?: unknown;
  decisionPayload?: unknown;
};
