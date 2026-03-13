const APPROVAL_TIMESTAMP = "2026-01-01T00:00:00.000Z";

export const DESKTOP_TAKEOVER_URL = "http://localhost:6080/vnc.html?autoconnect=true";

const DEFAULT_DESKTOP_APPROVAL_CONTEXT = {
  source: "agent-tool-execution",
  tool_id: "tool.node.dispatch",
  tool_call_id: "tc-1",
  tool_match_target: "tool.node.dispatch.desktop.act",
  args: {
    capability: "tyrum.desktop.act",
    action_name: "act",
    input: {
      target: { kind: "a11y", role: "button", name: "Submit", states: [] },
      action: { kind: "click" },
    },
  },
} as const;

type DesktopApprovalOptions = {
  approvalId?: number;
  approvalKey?: string;
  status?: string;
  context?: Record<string, unknown>;
  latestReview?: unknown;
  scope?: {
    run_id: string;
    step_id: string;
  };
};

type ApprovedDesktopPairingOptions = {
  pairingId?: number;
  label?: string;
  metadata?: Record<string, unknown>;
  latestReview?: unknown;
};

type DesktopRunOptions = {
  runId: string;
  jobId: string;
  attempt?: number;
};

type DesktopStepOptions = {
  runId: string;
  stepId: string;
  approvalId?: number;
};

type DesktopArtifactOptions = {
  artifactId: string;
  kind: string;
  mimeType: string;
  labels: string[];
};

type DesktopAttemptOptions = {
  attemptId: string;
  stepId: string;
  attempt: number;
  artifacts: readonly unknown[];
};

export function createDesktopApprovalFixture({
  approvalId = 1,
  approvalKey = `approval:${approvalId}`,
  status = "awaiting_human",
  context = DEFAULT_DESKTOP_APPROVAL_CONTEXT,
  latestReview = null,
  scope,
}: DesktopApprovalOptions = {}) {
  return {
    approval_id: approvalId,
    approval_key: approvalKey,
    kind: "workflow_step",
    status,
    prompt: "Approve execution of 'tool.node.dispatch'",
    motivation: "The agent needs desktop interaction to submit the form.",
    context,
    ...(scope ? { scope } : {}),
    created_at: APPROVAL_TIMESTAMP,
    expires_at: null,
    latest_review: latestReview,
  } as const;
}

export function createApprovedDesktopPairingFixture({
  pairingId = 99,
  label = `tyrum-desktop-sandbox (takeover: ${DESKTOP_TAKEOVER_URL})`,
  metadata,
  latestReview = null,
}: ApprovedDesktopPairingOptions = {}) {
  return {
    pairing_id: pairingId,
    status: "approved",
    motivation: "The approved node provides the desktop capability used for takeover.",
    trust_level: "local",
    requested_at: APPROVAL_TIMESTAMP,
    node: {
      node_id: "node-1",
      label,
      last_seen_at: APPROVAL_TIMESTAMP,
      capabilities: [{ id: "tyrum.desktop.act", version: "1.0.0" }],
      ...(metadata ? { metadata } : {}),
    },
    capability_allowlist: [{ id: "tyrum.desktop.act", version: "1.0.0" }],
    latest_review: latestReview,
  } as const;
}

export function createPausedDesktopRunFixture({ runId, jobId, attempt = 1 }: DesktopRunOptions) {
  return {
    run_id: runId,
    job_id: jobId,
    key: "key-1",
    lane: "main",
    status: "paused",
    attempt,
    created_at: APPROVAL_TIMESTAMP,
    started_at: APPROVAL_TIMESTAMP,
    finished_at: null,
    paused_reason: "approval",
    paused_detail: "approval pending",
  } as const;
}

export function createPausedDesktopStepFixture({
  runId,
  stepId,
  approvalId = 1,
}: DesktopStepOptions) {
  return {
    step_id: stepId,
    run_id: runId,
    step_index: 0,
    status: "paused",
    action: { type: "Desktop", args: {} },
    created_at: APPROVAL_TIMESTAMP,
    approval_id: approvalId,
  } as const;
}

export function createDesktopArtifactFixture({
  artifactId,
  kind,
  mimeType,
  labels,
}: DesktopArtifactOptions) {
  return {
    artifact_id: artifactId,
    uri: `artifact://${artifactId}`,
    kind,
    created_at: APPROVAL_TIMESTAMP,
    mime_type: mimeType,
    labels,
  } as const;
}

export function createRunningDesktopAttemptFixture({
  attemptId,
  stepId,
  attempt,
  artifacts,
}: DesktopAttemptOptions) {
  return {
    attempt_id: attemptId,
    step_id: stepId,
    attempt,
    status: "running",
    started_at: APPROVAL_TIMESTAMP,
    finished_at: null,
    error: null,
    artifacts,
  } as const;
}
