import type {
  SampleExecutionAttemptStatus,
  SampleExecutionStepStatus,
} from "./operator-ui.test-support.js";

export function sampleStatusResponse() {
  return {
    status: "ok",
    version: "0.1.0",
    instance_id: "gateway-1",
    role: "gateway",
    db_kind: "sqlite",
    is_exposed: false,
    otel_enabled: false,
    ws: null,
    policy: null,
    model_auth: null,
    catalog_freshness: null,
    session_lanes: null,
    queue_depth: null,
    sandbox: null,
    config_health: { status: "ok", issues: [] },
  } as const;
}

export function sampleUsageResponse() {
  return {
    status: "ok",
    generated_at: "2026-01-01T00:00:00.000Z",
    scope: { kind: "deployment", run_id: null, key: null, agent_id: null },
    local: {
      attempts: { total_with_cost: 0, parsed: 0, invalid: 0 },
      totals: {
        duration_ms: 0,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        usd_micros: 0,
      },
    },
    provider: null,
  } as const;
}

export function sampleAgentStatusResponse() {
  return {
    enabled: true,
    home: "/tmp/agents/default",
    identity: {
      name: "Default Agent",
      description: "Primary operator agent",
    },
    model: {
      model: "openai/gpt-5.4",
      variant: "balanced",
      fallback: ["openai/gpt-5.4"],
    },
    skills: ["review", "deploy"],
    workspace_skills_trusted: true,
    mcp: [
      {
        id: "filesystem",
        name: "Filesystem",
        enabled: true,
        transport: "stdio",
      },
    ],
    tools: ["shell", "http"],
    sessions: {
      ttl_days: 365,
      max_turns: 0,
      context_pruning: {
        max_messages: 0,
        tool_prune_keep_last_messages: 4,
      },
      loop_detection: {
        within_turn: {
          consecutive_repeat_limit: 2,
          cycle_repeat_limit: 3,
        },
        cross_turn: {
          window_assistant_messages: 8,
          similarity_threshold: 0.92,
        },
      },
    },
  } as const;
}

export function samplePresenceResponse() {
  return {
    status: "ok",
    generated_at: "2026-01-01T00:00:00.000Z",
    entries: [],
  } as const;
}

export function samplePairingRequestPending() {
  return {
    pairing_id: 1,
    status: "pending",
    requested_at: "2026-01-01T00:00:00.000Z",
    node: {
      node_id: "node-1",
      label: "my takeover: label (takeover: http://localhost:6080/vnc.html?autoconnect=true)",
      last_seen_at: "2026-01-01T00:00:00.000Z",
      capabilities: [],
    },
    capability_allowlist: [
      { id: "tyrum.cli", version: "1.0.0" },
      { id: "tyrum.http", version: "1.0.0" },
    ],
    resolution: null,
    resolved_at: null,
  } as const;
}

export function samplePairingRequestPendingWithNodeCapabilities() {
  const pending = samplePairingRequestPending();
  return {
    ...pending,
    node: {
      ...pending.node,
      capabilities: ["cli", "http"],
    },
    capability_allowlist: [],
  } as const;
}

export function samplePairingRequestApproved() {
  return {
    ...samplePairingRequestPending(),
    status: "approved",
    trust_level: "local",
    resolution: {
      decision: "approved",
      resolved_at: "2026-01-01T00:00:01.000Z",
      reason: "ok",
    },
    resolved_at: "2026-01-01T00:00:01.000Z",
  } as const;
}

export function sampleApprovalPending() {
  return {
    approval_id: 1,
    approval_key: "approval:1",
    kind: "other",
    status: "pending",
    prompt: "Allow the tool call?",
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: null,
    resolution: null,
  } as const;
}

export function sampleApprovalApproved() {
  return {
    ...sampleApprovalPending(),
    status: "approved",
    resolution: {
      decision: "approved",
      resolved_at: "2026-01-01T00:00:01.000Z",
      reason: "ok",
    },
  } as const;
}

export function sampleExecutionRun() {
  return {
    run_id: "11111111-1111-1111-1111-deadbeefcafe",
    job_id: "22222222-2222-2222-2222-222222222222",
    key: "agent:default:main",
    lane: "main",
    status: "running",
    attempt: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    started_at: "2026-01-01T00:00:00.000Z",
    finished_at: null,
  } as const;
}

export function sampleExecutionStep({
  stepId,
  stepIndex,
  status,
  actionType,
}: {
  stepId: string;
  stepIndex: number;
  status: SampleExecutionStepStatus;
  actionType: "Decide" | "Research";
}) {
  return {
    step_id: stepId,
    run_id: sampleExecutionRun().run_id,
    step_index: stepIndex,
    status,
    action: { type: actionType, args: {} },
    created_at: "2026-01-01T00:00:00.000Z",
  } as const;
}

export function sampleExecutionAttempt({
  attemptId,
  attempt,
  status,
  stepId,
  startedAt = "2026-01-01T00:00:00.000Z",
  finishedAt = null,
}: {
  attemptId: string;
  attempt: number;
  status: SampleExecutionAttemptStatus;
  stepId: string;
  startedAt?: string;
  finishedAt?: string | null;
}) {
  return {
    attempt_id: attemptId,
    step_id: stepId,
    attempt,
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    error: null,
    artifacts: [],
  } as const;
}
