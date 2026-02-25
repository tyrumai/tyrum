import { DEFAULT_WORKSPACE_ID, WorkspaceId } from "@tyrum/schemas";

export interface ResumeTokenRow {
  token: string;
  run_id: string;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
}

export interface RunnableRunRow {
  run_id: string;
  job_id: string;
  key: string;
  lane: string;
  status: "queued" | "running";
  trigger_json: string;
  workspace_id: string;
  policy_snapshot_id: string | null;
}

export interface StepRow {
  step_id: string;
  run_id: string;
  step_index: number;
  status: string;
  action_json: string;
  created_at: string | Date;
  idempotency_key: string | null;
  postcondition_json: string | null;
  approval_id: number | null;
  max_attempts: number;
  timeout_ms: number;
}

export function parsePlanIdFromTriggerJson(triggerJson: string): string | undefined {
  try {
    const parsed = JSON.parse(triggerJson) as unknown;
    if (parsed && typeof parsed === "object") {
      const metadata = (parsed as Record<string, unknown>)["metadata"];
      if (metadata && typeof metadata === "object") {
        const planId = (metadata as Record<string, unknown>)["plan_id"];
        if (typeof planId === "string" && planId.trim().length > 0) {
          return planId;
        }
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function normalizeWorkspaceId(input: string | undefined): string {
  const trimmed = input?.trim();
  if (!trimmed) return DEFAULT_WORKSPACE_ID;
  const parsed = WorkspaceId.safeParse(trimmed);
  return parsed.success ? parsed.data : DEFAULT_WORKSPACE_ID;
}
