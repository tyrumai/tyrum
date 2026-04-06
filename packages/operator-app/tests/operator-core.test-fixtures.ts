import type {
  Approval,
  DesktopEnvironment,
  DesktopEnvironmentHost,
  ExecutionRun,
  NodePairingRequest,
  PresenceEntry,
  ReviewEntry,
} from "@tyrum/contracts";
import type {
  PairingListResponse,
  PresenceResponse,
  StatusResponse,
  UsageResponse,
} from "@tyrum/transport-sdk";

export function sampleStatusResponse(): StatusResponse {
  return {
    status: "ok",
    version: "0.1.0",
    instance_id: "gateway-1",
    role: "gateway",
    db_kind: "sqlite",
    is_exposed: false,
    otel_enabled: false,
    auth: { enabled: true },
    ws: null,
    policy: null,
    model_auth: null,
    catalog_freshness: null,
    conversations: null,
    queue_depth: null,
    sandbox: null,
    config_health: { status: "ok", issues: [] },
  };
}

export function sampleUsageResponse(): UsageResponse {
  return {
    status: "ok",
    generated_at: "2026-01-01T00:00:00.000Z",
    scope: { kind: "deployment", run_id: null, key: null, agent_id: null },
    local: {
      attempts: { total_with_cost: 0, parsed: 0, invalid: 0 },
      totals: { duration_ms: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, usd_micros: 0 },
    },
    provider: null,
  };
}

export function samplePresenceResponse(): PresenceResponse {
  return {
    status: "ok",
    generated_at: "2026-01-01T00:00:00.000Z",
    entries: [],
  };
}

export function samplePairingListResponse(): PairingListResponse {
  return { status: "ok", pairings: [] };
}

export function sampleDesktopEnvironmentHost(): DesktopEnvironmentHost {
  return {
    host_id: "host-1",
    label: "Primary runtime",
    version: "0.1.0",
    docker_available: true,
    healthy: true,
    last_seen_at: "2026-01-01T00:00:00.000Z",
    last_error: null,
  };
}

export function sampleDesktopEnvironment(): DesktopEnvironment {
  return {
    environment_id: "env-1",
    host_id: "host-1",
    label: "Research desktop",
    image_ref: "registry.example.test/desktop@sha256:1234",
    managed_kind: "docker",
    status: "running",
    desired_running: true,
    node_id: "node-desktop-1",
    last_seen_at: "2026-01-01T00:00:00.000Z",
    last_error: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function sampleReview(
  input: Partial<ReviewEntry> &
    Pick<ReviewEntry, "review_id" | "target_type" | "target_id" | "reviewer_kind" | "state">,
): ReviewEntry {
  return {
    reviewer_id: null,
    reason: null,
    risk_level: null,
    risk_score: null,
    evidence: null,
    decision_payload: null,
    created_at: "2026-01-01T00:00:00.000Z",
    started_at: null,
    completed_at: null,
    ...input,
  };
}

export function sampleApprovalPending(): Approval {
  return {
    approval_id: "11111111-1111-1111-1111-111111111111",
    approval_key: "approval:11111111-1111-1111-1111-111111111111",
    kind: "policy",
    status: "awaiting_human",
    prompt: "Approve?",
    motivation: "Approval is required before execution can continue.",
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: null,
    latest_review: sampleReview({
      review_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      target_type: "approval",
      target_id: "11111111-1111-1111-1111-111111111111",
      reviewer_kind: "human",
      state: "requested_human",
    }),
  };
}

export function sampleApprovalApproved(): Approval {
  return {
    ...sampleApprovalPending(),
    status: "approved",
    latest_review: sampleReview({
      review_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      target_type: "approval",
      target_id: "11111111-1111-1111-1111-111111111111",
      reviewer_kind: "human",
      state: "approved",
      reason: "approved",
      completed_at: "2026-01-01T00:00:01.000Z",
    }),
  };
}

export function samplePairingPending(): NodePairingRequest {
  return {
    pairing_id: 10,
    status: "awaiting_human",
    motivation: "A new node wants to connect.",
    trust_level: "local",
    requested_at: "2026-01-01T00:00:00.000Z",
    node: {
      node_id: "node-1",
      label: "test-node",
      capabilities: [],
      last_seen_at: "2026-01-01T00:00:00.000Z",
    },
    capability_allowlist: [],
    latest_review: sampleReview({
      review_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      target_type: "pairing",
      target_id: "10",
      reviewer_kind: "human",
      state: "requested_human",
    }),
  };
}

export function samplePairingApproved(): NodePairingRequest {
  return {
    ...samplePairingPending(),
    status: "approved",
    trust_level: "local",
    latest_review: sampleReview({
      review_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      target_type: "pairing",
      target_id: "10",
      reviewer_kind: "human",
      state: "approved",
      reason: "approved",
      completed_at: "2026-01-01T00:00:01.000Z",
    }),
  };
}

export function samplePairingDenied(): NodePairingRequest {
  return {
    ...samplePairingPending(),
    status: "denied",
    latest_review: sampleReview({
      review_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      target_type: "pairing",
      target_id: "10",
      reviewer_kind: "human",
      state: "denied",
      reason: "denied",
      completed_at: "2026-01-01T00:00:01.000Z",
    }),
  };
}

export function samplePairingRevoked(): NodePairingRequest {
  return {
    ...samplePairingPending(),
    status: "revoked",
    latest_review: sampleReview({
      review_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      target_type: "pairing",
      target_id: "10",
      reviewer_kind: "human",
      state: "revoked",
      reason: "revoked",
      completed_at: "2026-01-01T00:00:01.000Z",
    }),
  };
}

export function samplePresenceEntry(): PresenceEntry {
  return {
    instance_id: "client-1",
    role: "client",
    last_seen_at: "2026-01-01T00:00:00.000Z",
  };
}

export function sampleRun(): ExecutionRun {
  return {
    run_id: "run-1",
    job_id: "job-1",
    key: "t:test",
    status: "running",
    attempt: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    started_at: "2026-01-01T00:00:01.000Z",
    finished_at: null,
  };
}
