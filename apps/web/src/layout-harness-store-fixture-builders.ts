import { AgentConfig, IdentityPack } from "../../../packages/schemas/src/index.js";

const FIXTURE_TIMESTAMP = "2026-03-08T00:00:00.000Z";

export function createLayoutHarnessActiveSession() {
  return {
    session_id: "session-1",
    agent_id: "default",
    channel: "ui",
    thread_id: "ui-thread-1",
    title: "Layout regression coverage",
    summary: "Layout regression coverage thread",
    transcript: [
      {
        kind: "text" as const,
        id: "turn-1",
        role: "user" as const,
        content: "Can we prevent page overflow regressions?",
        created_at: FIXTURE_TIMESTAMP,
      },
      {
        kind: "text" as const,
        id: "turn-2",
        role: "assistant" as const,
        content: "Yes. We can add browser geometry checks.",
        created_at: "2026-03-08T00:00:01.000Z",
      },
    ],
    updated_at: FIXTURE_TIMESTAMP,
    created_at: FIXTURE_TIMESTAMP,
  };
}

export function createLayoutHarnessPendingPairing() {
  return {
    pairing_id: 1,
    status: "awaiting_human",
    motivation: "This node connected and needs trust and capability review.",
    trust_level: "local",
    requested_at: FIXTURE_TIMESTAMP,
    node: {
      node_id: "node-1",
      label: "My node",
      last_seen_at: FIXTURE_TIMESTAMP,
      capabilities: [
        { id: "tyrum.desktop.snapshot", version: "1.0.0" },
        { id: "tyrum.cli.exec", version: "1.0.0" },
        { id: "tyrum.http.fetch", version: "1.0.0" },
      ],
      metadata: {
        platform: "darwin",
        version: "14.0",
        mode: "local",
        ip: "127.0.0.1",
      },
    },
    capability_allowlist: [
      { id: "tyrum.desktop.snapshot", version: "1.0.0" },
      { id: "tyrum.cli.exec", version: "1.0.0" },
    ],
    latest_review: {
      review_id: "00000000-0000-4000-8000-000000000021",
      target_type: "pairing",
      target_id: "1",
      reviewer_kind: "system",
      reviewer_id: null,
      state: "requested_human",
      reason: "Awaiting human review.",
      risk_level: null,
      risk_score: null,
      evidence: null,
      decision_payload: null,
      created_at: FIXTURE_TIMESTAMP,
      started_at: null,
      completed_at: FIXTURE_TIMESTAMP,
    },
  };
}

export function createLayoutHarnessApprovedPairing() {
  const pending = createLayoutHarnessPendingPairing();
  return {
    ...pending,
    pairing_id: 2,
    status: "approved",
    latest_review: {
      review_id: "00000000-0000-4000-8000-000000000022",
      target_type: "pairing",
      target_id: "2",
      reviewer_kind: "guardian",
      reviewer_id: "reviewer-1",
      state: "approved",
      reason: "Guardian approved the node pairing with the selected capabilities.",
      risk_level: "low",
      risk_score: 0.12,
      evidence: null,
      decision_payload: {
        trust_level: "local",
        capability_allowlist: [
          { id: "tyrum.desktop.snapshot", version: "1.0.0" },
          { id: "tyrum.cli.exec", version: "1.0.0" },
        ],
      },
      created_at: "2026-03-08T00:01:00.000Z",
      started_at: "2026-03-08T00:01:00.000Z",
      completed_at: "2026-03-08T00:01:00.000Z",
    },
  };
}

export function createLayoutHarnessAgentStatus() {
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
    skills: ["review"],
    skills_detailed: [
      {
        id: "review",
        name: "Review",
        version: "1.0.0",
        source: "bundled",
      },
    ],
    workspace_skills_trusted: true,
    mcp: [],
    tools: ["shell"],
    sessions: {
      ttl_days: 365,
      max_turns: 0,
      loop_detection: {
        within_turn: {
          enabled: true,
          consecutive_repeat_limit: 3,
          cycle_repeat_limit: 3,
        },
        cross_turn: {
          enabled: true,
          window_assistant_messages: 3,
          similarity_threshold: 0.97,
          min_chars: 120,
          cooldown_assistant_messages: 6,
        },
      },
      context_pruning: {
        max_messages: 0,
        tool_prune_keep_last_messages: 4,
      },
    },
  };
}

export function createLayoutHarnessMemoryItem() {
  return {
    memory_item_id: "memory-1",
    kind: "note",
    body_md: "Keep layout wrappers box-sized.",
    tags: ["layout", "regression"],
    sensitivity: "private",
    created_at: FIXTURE_TIMESTAMP,
    updated_at: FIXTURE_TIMESTAMP,
    provenance: undefined,
  };
}

export function createManagedAgentDetailFixture(agentKey: string) {
  const isDefaultAgent = agentKey === "default";
  const name = isDefaultAgent ? "Default Agent" : "Agent One";

  return {
    agent_id: isDefaultAgent
      ? "11111111-1111-4111-8111-111111111111"
      : "22222222-2222-4222-8222-222222222222",
    agent_key: agentKey,
    created_at: FIXTURE_TIMESTAMP,
    updated_at: FIXTURE_TIMESTAMP,
    has_config: true,
    has_identity: true,
    can_delete: !isDefaultAgent,
    persona: {
      name,
      description: "Managed agent",
      tone: "direct",
      palette: "graphite",
      character: "architect",
    },
    config: AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      persona: {
        name,
        description: "Managed agent",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
    }),
    identity: IdentityPack.parse({
      meta: {
        name,
        description: "Managed agent",
        style: {
          tone: "direct",
        },
      },
      body: "",
    }),
    config_revision: 1,
    identity_revision: 1,
    config_sha256: "a".repeat(64),
    identity_sha256: "b".repeat(64),
  };
}
