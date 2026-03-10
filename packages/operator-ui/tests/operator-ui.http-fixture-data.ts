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

export function sampleNodeInventoryResponse() {
  return {
    status: "ok",
    generated_at: "2026-01-01T00:00:00.000Z",
    nodes: [
      {
        node_id: "node-1",
        label: "my takeover: label (takeover: http://localhost:6080/vnc.html?autoconnect=true)",
        connected: false,
        paired_status: "approved",
        attached_to_requested_lane: false,
        capabilities: [],
      },
    ],
  } as const;
}
