const APPROVAL_TIMESTAMP = "2026-01-01T00:00:00.000Z";

export const DESKTOP_TAKEOVER_URL = "http://localhost:6080/vnc.html?autoconnect=true";

const DEFAULT_DESKTOP_APPROVAL_CONTEXT = {
  source: "agent-tool-execution",
  tool_id: "tool.desktop.act",
  tool_call_id: "tc-1",
  tool_match_target: "tool.desktop.act",
  routing: {
    requested_node_id: "node-1",
    selected_node_id: "node-1",
    selection_mode: "explicit",
  },
  args: {
    node_id: "node-1",
    target: { kind: "a11y", role: "button", name: "Submit", states: [] },
    action: { kind: "click" },
  },
} as const;

type DesktopApprovalOptions = {
  approvalId?: number;
  approvalKey?: string;
  agentId?: string;
  status?: string;
  context?: Record<string, unknown>;
  latestReview?: unknown;
  managed_desktop?: {
    environment_id: string;
  };
  scope?: {
    turn_id: string;
    turn_item_id?: string;
    workflow_run_step_id?: string;
  };
};

type ApprovedDesktopPairingOptions = {
  pairingId?: number;
  label?: string;
  metadata?: Record<string, unknown>;
  latestReview?: unknown;
};

type DesktopRunOptions = {
  turnId: string;
  jobId: string;
  attempt?: number;
};

export function createDesktopApprovalFixture({
  approvalId = 1,
  approvalKey = `approval:${approvalId}`,
  agentId = "00000000-0000-4000-8000-000000000002",
  status = "awaiting_human",
  context = DEFAULT_DESKTOP_APPROVAL_CONTEXT,
  latestReview = null,
  managed_desktop = { environment_id: "env-1" },
  scope,
}: DesktopApprovalOptions = {}) {
  return {
    approval_id: approvalId,
    approval_key: approvalKey,
    agent_id: agentId,
    kind: "workflow_step",
    status,
    prompt: "Approve execution of 'tool.desktop.act' on node 'node-1'",
    motivation: "The agent needs desktop interaction to submit the form.",
    context: {
      ...DEFAULT_DESKTOP_APPROVAL_CONTEXT,
      ...context,
    },
    ...(scope ? { scope } : {}),
    managed_desktop,
    created_at: APPROVAL_TIMESTAMP,
    expires_at: null,
    latest_review: latestReview,
  } as const;
}

export function createApprovedDesktopPairingFixture({
  pairingId = 99,
  label = "tyrum-desktop-sandbox",
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
      managed_desktop: { environment_id: "env-1" },
      ...(metadata ? { metadata } : {}),
    },
    capability_allowlist: [{ id: "tyrum.desktop.act", version: "1.0.0" }],
    latest_review: latestReview,
  } as const;
}

export function createPausedDesktopRunFixture({ turnId, jobId, attempt = 1 }: DesktopRunOptions) {
  return {
    turn_id: turnId,
    job_id: jobId,
    conversation_key: "agent:default:ui:default:channel:approval",
    status: "paused",
    attempt,
    created_at: APPROVAL_TIMESTAMP,
    started_at: APPROVAL_TIMESTAMP,
    finished_at: null,
    blocked_reason: "approval",
    blocked_detail: "approval pending",
  } as const;
}
