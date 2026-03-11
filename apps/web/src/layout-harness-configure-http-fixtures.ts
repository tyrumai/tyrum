function createConfiguredProviders() {
  return {
    providers: [
      {
        provider_key: "openai",
        name: "OpenAI",
        doc: null,
        supported: true,
        accounts: [],
      },
    ],
  };
}

function createPresetList() {
  return {
    status: "ok" as const,
    presets: [
      {
        preset_id: "preset-1",
        preset_key: "preset-default",
        display_name: "Default",
        provider_key: "openai",
        model_id: "gpt-4.1",
        options: {},
        created_at: "2026-03-08T00:00:00.000Z",
        updated_at: "2026-03-08T00:00:00.000Z",
      },
    ],
  };
}

function createAssignments() {
  return {
    status: "ok" as const,
    assignments: [
      {
        execution_profile_id: "default",
        preset_key: "preset-default",
        preset_display_name: "Default",
        provider_key: "openai",
        model_id: "gpt-4.1",
      },
    ],
  };
}

export function createHarnessConfigureHttpFixtures() {
  const configuredProviders = createConfiguredProviders();
  const presetList = createPresetList();
  const assignments = createAssignments();

  return {
    authTokens: {
      list: async () => ({ tokens: [] }),
      issue: async () => ({
        token: "secret",
        token_id: "token-1",
        tenant_id: "11111111-1111-4111-8111-111111111111",
        display_name: "Harness token",
        role: "client" as const,
        device_id: "operator-ui",
        scopes: ["operator.read"],
        issued_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-01T00:00:00.000Z",
        expires_at: "2026-03-02T00:00:00.000Z",
      }),
      update: async () => ({
        token: {
          token_id: "token-1",
          tenant_id: "11111111-1111-4111-8111-111111111111",
          display_name: "Harness token",
          role: "client" as const,
          device_id: "operator-ui",
          scopes: ["operator.read", "operator.write"],
          issued_at: "2026-03-01T00:00:00.000Z",
          expires_at: "2026-03-02T00:00:00.000Z",
          revoked_at: null,
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T01:00:00.000Z",
        },
      }),
      revoke: async () => ({ revoked: true, token_id: "token-1" }),
    },
    agentList: {
      get: async () => ({
        agents: [
          {
            agent_key: "default",
            agent_id: "agent-1",
            has_config: true,
            persona: {
              name: "Default",
              description: "Default agent",
              tone: "direct",
              palette: "blue",
              character: "pragmatic",
            },
          },
        ],
      }),
    },
    deviceTokens: {
      issue: async () => ({ status: "ok" as const, token: "device-token" }),
      revoke: async () => ({ status: "ok" as const }),
    },
    policy: {
      getBundle: async () => ({
        status: "ok" as const,
        generated_at: "2026-03-08T00:00:00.000Z",
        effective: {
          sha256: "policy-sha-1",
          bundle: {
            v: 1,
            tools: {
              default: "require_approval" as const,
              allow: ["read"],
              require_approval: [],
              deny: [],
            },
            network_egress: {
              default: "require_approval" as const,
              allow: [],
              require_approval: [],
              deny: [],
            },
            secrets: {
              default: "require_approval" as const,
              allow: [],
              require_approval: [],
              deny: [],
            },
            connectors: {
              default: "require_approval" as const,
              allow: ["telegram:*"],
              require_approval: [],
              deny: [],
            },
            artifacts: { default: "allow" as const },
            provenance: { untrusted_shell_requires_approval: true },
          },
          sources: {
            deployment: "default",
            agent: null,
            playbook: null,
          },
        },
      }),
      listOverrides: async () => ({ status: "ok" as const, overrides: [] }),
      createOverride: async () => ({ status: "ok" as const }),
      revokeOverride: async () => ({ status: "ok" as const }),
    },
    policyConfig: {
      getDeployment: async () => ({
        revision: 1,
        agent_key: null,
        bundle: {
          v: 1,
          tools: {
            default: "require_approval" as const,
            allow: ["read"],
            require_approval: [],
            deny: [],
          },
          artifacts: { default: "allow" as const },
          provenance: { untrusted_shell_requires_approval: true },
        },
        created_at: "2026-03-08T00:00:00.000Z",
        created_by: { kind: "tenant.token", token_id: "token-1" },
        reason: "seed",
        reverted_from_revision: null,
      }),
      listDeploymentRevisions: async () => ({ revisions: [] }),
      updateDeployment: async (input: { bundle: unknown; reason?: string }) => ({
        revision: 1,
        agent_key: null,
        bundle: input.bundle,
        created_at: "2026-03-08T00:00:00.000Z",
        created_by: { kind: "tenant.token", token_id: "token-1" },
        reason: input.reason,
        reverted_from_revision: null,
      }),
      revertDeployment: async (input: { revision: number; reason?: string }) => ({
        revision: input.revision + 1,
        agent_key: null,
        bundle: {
          v: 1,
          tools: {
            default: "require_approval" as const,
            allow: ["read"],
            require_approval: [],
            deny: [],
          },
        },
        created_at: "2026-03-08T00:00:00.000Z",
        created_by: { kind: "tenant.token", token_id: "token-1" },
        reason: input.reason,
        reverted_from_revision: input.revision,
      }),
    },
    agents: {
      list: async () => ({
        agents: [
          {
            agent_id: "00000000-0000-4000-8000-000000000002",
            agent_key: "default",
            created_at: "2026-03-08T00:00:00.000Z",
            updated_at: "2026-03-08T00:00:00.000Z",
            has_config: true,
            has_identity: true,
            can_delete: false,
            persona: {
              name: "Default Agent",
              description: "Primary operator",
              tone: "Direct",
              palette: "neutral",
              character: "operator",
            },
          },
        ],
      }),
    },
    providerConfig: {
      listRegistry: async () => ({
        status: "ok" as const,
        providers: [
          {
            provider_key: "openai",
            name: "OpenAI",
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
      }),
      listProviders: async () => configuredProviders,
      createAccount: async () => ({ status: "ok" as const }),
      updateAccount: async () => ({ status: "ok" as const }),
      deleteAccount: async () => ({ status: "ok" as const }),
      deleteProvider: async () => ({ status: "ok" as const }),
    },
    modelConfig: {
      listPresets: async () => presetList,
      listAvailable: async () => ({
        status: "ok" as const,
        models: [
          {
            provider_key: "openai",
            provider_name: "OpenAI",
            model_id: "gpt-4.1",
            model_name: "GPT-4.1",
            family: null,
            reasoning: true,
            tool_call: true,
            modalities: { output: ["text"] },
          },
        ],
      }),
      createPreset: async () => ({ status: "ok" as const }),
      updatePreset: async () => ({ status: "ok" as const }),
      deletePreset: async () => ({ status: "ok" as const }),
      listAssignments: async () => assignments,
      updateAssignments: async () => ({
        status: "ok" as const,
        assignments: assignments.assignments,
      }),
    },
    routingConfig: {
      get: async () => ({
        revision: 1,
        config: {
          v: 1,
          telegram: {
            default_agent_key: "default",
            threads: { "tg-123": "default" },
          },
        },
      }),
      listRevisions: async () => ({
        revisions: [
          {
            revision: 1,
            config: {
              v: 1,
              telegram: {
                default_agent_key: "default",
                threads: { "tg-123": "default" },
              },
            },
            created_at: "2026-03-08T00:00:00.000Z",
          },
        ],
      }),
      listObservedTelegramThreads: async () => ({
        threads: [
          {
            channel: "telegram" as const,
            account_key: "default",
            thread_id: "tg-123",
            container_kind: "group" as const,
            session_title: "Support room",
            last_active_at: "2026-03-08T00:00:00.000Z",
          },
        ],
      }),
      update: async () => ({ revision: 2, config: { v: 1 } }),
      revert: async () => ({ revision: 2, config: { v: 1 } }),
    },
    secrets: {
      list: async () => ({
        handles: [
          {
            handle_id: "alpha",
            provider: "db" as const,
            scope: "alpha",
            created_at: "2026-03-08T00:00:00.000Z",
          },
          {
            handle_id: "beta",
            provider: "db" as const,
            scope: "scope:beta",
            created_at: "2026-03-09T00:00:00.000Z",
          },
          {
            handle_id: "provider-account:openai:api_key",
            provider: "db" as const,
            scope: "provider-account:openai:api_key",
            created_at: "2026-03-10T00:00:00.000Z",
          },
        ],
      }),
      store: async () => ({
        handle: {
          handle_id: "gamma",
          provider: "db" as const,
          scope: "gamma",
          created_at: "2026-03-10T00:00:00.000Z",
        },
      }),
      rotate: async () => ({
        revoked: true,
        handle: {
          handle_id: "alpha",
          provider: "db" as const,
          scope: "alpha",
          created_at: "2026-03-08T00:00:00.000Z",
        },
      }),
      revoke: async () => ({ revoked: true }),
    },
    audit: {
      listPlans: async () => ({
        status: "ok" as const,
        plans: [
          {
            plan_key: "plan-default",
            plan_id: "00000000-0000-4000-8000-000000000100",
            kind: "planner",
            status: "success",
            event_count: 4,
            last_event_at: "2026-03-08T00:00:00.000Z",
          },
        ],
      }),
      exportReceiptBundle: async () => ({
        plan_id: "00000000-0000-4000-8000-000000000100",
        events: [],
        chain_verification: {
          valid: true,
          checked_count: 0,
          broken_at_index: null,
          broken_at_id: null,
        },
        exported_at: "2026-03-08T00:00:00.000Z",
      }),
      verify: async () => ({
        valid: true,
        checked_count: 0,
        broken_at_index: null,
        broken_at_id: null,
      }),
      forget: async () => ({ decision: "delete" as const, deleted_count: 3, proof_event_id: 4 }),
    },
    plugins: {
      list: async () => ({ plugins: [{ id: "echo", version: "1.0.0" }] }),
      get: async () => ({ id: "echo", version: "1.0.0", description: "Test plugin" }),
    },
  };
}
