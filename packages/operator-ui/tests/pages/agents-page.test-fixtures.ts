export function sampleAgentStatus() {
  return {
    enabled: true,
    home: "/tmp/agents/default",
    identity: { name: "Default Agent" },
    model: {
      model: "openai/gpt-5.4",
      variant: "balanced",
      fallback: ["openai/gpt-5.4"],
    },
    skills: ["review"],
    skills_detailed: [{ id: "review", name: "Review", version: "1.0.0", source: "bundled" }],
    workspace_skills_trusted: true,
    mcp: [],
    tools: ["shell"],
    sessions: {
      ttl_days: 365,
      max_turns: 0,
      loop_detection: {
        within_turn: { enabled: true, consecutive_repeat_limit: 3, cycle_repeat_limit: 3 },
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
  } as const;
}

export function createTranscriptFixture() {
  const latestRootSession = {
    session_id: "550e8400-e29b-41d4-a716-446655440010",
    session_key: "agent:default:ui:latest",
    agent_id: "default",
    channel: "ui",
    thread_id: "thread-default-latest",
    title: "Latest retained transcript",
    message_count: 2,
    updated_at: "2026-03-09T00:05:00.000Z",
    created_at: "2026-03-09T00:00:00.000Z",
    archived: false,
    latest_run_id: "550e8400-e29b-41d4-a716-446655440110",
    latest_run_status: "running" as const,
    has_active_run: true,
    pending_approval_count: 1,
  };
  const childSession = {
    session_id: "550e8400-e29b-41d4-a716-446655440011",
    session_key: "agent:default:subagent:550e8400-e29b-41d4-a716-446655440099",
    agent_id: "default",
    channel: "subagent",
    thread_id: "thread-default-child",
    title: "Delegated child",
    message_count: 1,
    updated_at: "2026-03-09T00:04:00.000Z",
    created_at: "2026-03-09T00:01:00.000Z",
    archived: false,
    parent_session_key: latestRootSession.session_key,
    subagent_id: "550e8400-e29b-41d4-a716-446655440099",
    lane: "subagent",
    execution_profile: "executor",
    subagent_status: "running" as const,
    latest_run_id: null,
    latest_run_status: null,
    has_active_run: false,
    pending_approval_count: 0,
  };
  const olderRootSession = {
    session_id: "550e8400-e29b-41d4-a716-446655440012",
    session_key: "agent:default:ui:older",
    agent_id: "default",
    channel: "ui",
    thread_id: "thread-default-older",
    title: "Older retained transcript",
    message_count: 1,
    updated_at: "2026-03-08T00:05:00.000Z",
    created_at: "2026-03-08T00:00:00.000Z",
    archived: false,
    latest_run_id: null,
    latest_run_status: null,
    has_active_run: false,
    pending_approval_count: 0,
  };
  const secondaryAgentRoot = {
    session_id: "550e8400-e29b-41d4-a716-446655440013",
    session_key: "agent:agent-1:ui:main",
    agent_id: "agent-1",
    channel: "ui",
    thread_id: "thread-agent-1-main",
    title: "Agent One transcript",
    message_count: 1,
    updated_at: "2026-03-09T00:03:00.000Z",
    created_at: "2026-03-09T00:02:00.000Z",
    archived: false,
    latest_run_id: null,
    latest_run_status: null,
    has_active_run: false,
    pending_approval_count: 0,
  };
  const artifact = {
    artifact_id: "550e8400-e29b-41d4-a716-446655440120",
    uri: "artifact://550e8400-e29b-41d4-a716-446655440120",
    external_url: "https://gateway.test/artifacts/550e8400-e29b-41d4-a716-446655440120",
    kind: "log",
    media_class: "document",
    created_at: "2026-03-09T00:02:05.000Z",
    filename: "transcript.log",
    mime_type: "text/plain",
    labels: [],
  };

  const lineages = {
    [latestRootSession.session_key]: {
      rootSessionKey: latestRootSession.session_key,
      sessions: [latestRootSession, childSession],
      events: [
        {
          event_id: "message:latest:msg-1",
          kind: "message" as const,
          occurred_at: "2026-03-09T00:00:10.000Z",
          session_key: latestRootSession.session_key,
          payload: {
            message: {
              id: "msg-1",
              role: "user" as const,
              parts: [{ type: "text" as const, text: "Inspect the latest transcript" }],
            },
          },
        },
        {
          event_id: "run:550e8400-e29b-41d4-a716-446655440110",
          kind: "run" as const,
          occurred_at: "2026-03-09T00:02:00.000Z",
          session_key: latestRootSession.session_key,
          payload: {
            run: {
              run_id: "550e8400-e29b-41d4-a716-446655440110",
              job_id: "550e8400-e29b-41d4-a716-446655440111",
              key: latestRootSession.session_key,
              lane: "main",
              status: "running" as const,
              attempt: 1,
              created_at: "2026-03-09T00:02:00.000Z",
              started_at: "2026-03-09T00:02:01.000Z",
              finished_at: null,
            },
            steps: [
              {
                step_id: "550e8400-e29b-41d4-a716-446655440112",
                run_id: "550e8400-e29b-41d4-a716-446655440110",
                step_index: 0,
                status: "running" as const,
                action: { type: "Research", args: {} },
                created_at: "2026-03-09T00:02:00.000Z",
              },
            ],
            attempts: [
              {
                attempt_id: "550e8400-e29b-41d4-a716-446655440113",
                step_id: "550e8400-e29b-41d4-a716-446655440112",
                attempt: 1,
                status: "running" as const,
                started_at: "2026-03-09T00:02:01.000Z",
                finished_at: null,
                error: null,
                artifacts: [artifact],
              },
            ],
          },
        },
        {
          event_id: "approval:550e8400-e29b-41d4-a716-446655440114",
          kind: "approval" as const,
          occurred_at: "2026-03-09T00:03:00.000Z",
          session_key: latestRootSession.session_key,
          payload: {
            approval: {
              approval_id: "550e8400-e29b-41d4-a716-446655440114",
              approval_key: "approval:latest",
              agent_id: "default",
              kind: "policy" as const,
              status: "queued" as const,
              prompt: "Approve the next action?",
              motivation: "Approve the next action?",
              scope: {
                run_id: "550e8400-e29b-41d4-a716-446655440110",
                step_id: "550e8400-e29b-41d4-a716-446655440112",
                attempt_id: "550e8400-e29b-41d4-a716-446655440113",
              },
              created_at: "2026-03-09T00:03:00.000Z",
              expires_at: null,
              latest_review: null,
            },
          },
        },
        {
          event_id: "subagent:550e8400-e29b-41d4-a716-446655440099:spawned",
          kind: "subagent" as const,
          occurred_at: "2026-03-09T00:01:00.000Z",
          session_key: childSession.session_key,
          parent_session_key: latestRootSession.session_key,
          subagent_id: childSession.subagent_id,
          payload: {
            phase: "spawned" as const,
            subagent: {
              subagent_id: "550e8400-e29b-41d4-a716-446655440099",
              tenant_id: "tenant-default",
              agent_id: "00000000-0000-4000-8000-000000000001",
              workspace_id: "00000000-0000-4000-8000-000000000002",
              parent_session_key: latestRootSession.session_key,
              session_key: childSession.session_key,
              lane: "subagent",
              status: "running" as const,
              execution_profile: "executor",
              created_at: "2026-03-09T00:01:00.000Z",
              updated_at: "2026-03-09T00:01:00.000Z",
              closed_at: null,
            },
          },
        },
      ],
    },
    [olderRootSession.session_key]: {
      rootSessionKey: olderRootSession.session_key,
      sessions: [olderRootSession],
      events: [
        {
          event_id: "message:older:msg-1",
          kind: "message" as const,
          occurred_at: "2026-03-08T00:00:10.000Z",
          session_key: olderRootSession.session_key,
          payload: {
            message: {
              id: "older-msg-1",
              role: "assistant" as const,
              parts: [{ type: "text" as const, text: "Older retained transcript." }],
            },
          },
        },
      ],
    },
    [secondaryAgentRoot.session_key]: {
      rootSessionKey: secondaryAgentRoot.session_key,
      sessions: [secondaryAgentRoot],
      events: [
        {
          event_id: "message:agent-1:msg-1",
          kind: "message" as const,
          occurred_at: "2026-03-09T00:02:10.000Z",
          session_key: secondaryAgentRoot.session_key,
          payload: {
            message: {
              id: "agent-1-msg-1",
              role: "assistant" as const,
              parts: [{ type: "text" as const, text: "Agent One retained transcript." }],
            },
          },
        },
      ],
    },
  };

  return {
    latestRootSession,
    childSession,
    olderRootSession,
    secondaryAgentRoot,
    artifact,
    lineages,
    sessions: [latestRootSession, childSession, olderRootSession, secondaryAgentRoot],
  };
}

export function samplePresets() {
  return {
    status: "ok" as const,
    presets: [
      {
        preset_id: "33333333-3333-4333-8333-333333333333",
        preset_key: "gpt-5-4",
        display_name: "GPT-5.4",
        provider_key: "openrouter",
        model_id: "openai/gpt-5.4",
        options: {},
        created_at: "2026-03-08T00:00:00.000Z",
        updated_at: "2026-03-08T00:00:00.000Z",
      },
    ],
  };
}

export function sampleAvailableModels() {
  return {
    status: "ok" as const,
    models: [
      {
        provider_key: "openrouter",
        provider_name: "OpenRouter",
        model_id: "openai/gpt-5.4",
        model_name: "GPT-5.4",
        family: "GPT-5",
        reasoning: true,
        tool_call: true,
        modalities: { output: ["text"] },
      },
    ],
  };
}

export function sampleRegistry() {
  return {
    status: "ok" as const,
    providers: [
      {
        provider_key: "openrouter",
        name: "OpenRouter",
        doc: null,
        supported: true,
        methods: [
          {
            method_key: "api_key",
            label: "API key",
            type: "api_key",
            fields: [
              {
                key: "api_key",
                label: "API key",
                description: null,
                kind: "secret",
                input: "password",
                required: true,
              },
            ],
          },
        ],
      },
    ],
  };
}

export function sampleConfiguredProviders() {
  return {
    status: "ok" as const,
    providers: [
      {
        provider_key: "openrouter",
        name: "OpenRouter",
        doc: null,
        supported: true,
        accounts: [
          {
            account_id: "33333333-3333-4333-8333-333333333334",
            account_key: "openrouter-primary",
            provider_key: "openrouter",
            display_name: "OpenRouter",
            method_key: "api_key",
            type: "api_key",
            status: "active",
            config: {},
            configured_secret_keys: ["api_key"],
            created_at: "2026-03-08T00:00:00.000Z",
            updated_at: "2026-03-08T00:00:00.000Z",
          },
        ],
      },
    ],
  };
}
