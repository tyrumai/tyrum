function createManagedSkillSummary() {
  return {
    kind: "skill" as const,
    key: "example-skill",
    name: "Example Skill",
    description: "Harness skill",
    version: "1.0.0",
    enabled: true,
    revision: 1,
    source: { kind: "direct-url" as const, url: "https://example.com/skill.zip", filename: null },
    refreshable: true,
    materialized_path: "/tmp/skill/SKILL.md",
    assignment_count: 1,
    transport: null,
  };
}

function createManagedSkillDetail(key: string) {
  return {
    ...createManagedSkillSummary(),
    key,
    manifest: {
      meta: { id: key, name: "Example Skill", version: "1.0.0" },
      body: "Harness skill body.",
    },
    spec: null,
    files: ["SKILL.md"],
    revisions: [
      {
        revision: 1,
        enabled: true,
        created_at: "2026-03-01T00:00:00.000Z",
        reason: null,
        reverted_from_revision: null,
      },
    ],
  };
}

function createManagedMcpSummary() {
  return {
    kind: "mcp" as const,
    key: "calendar",
    name: "Calendar MCP",
    description: null,
    version: null,
    enabled: true,
    revision: 1,
    source: {
      kind: "npm" as const,
      npm_spec: "@scope/calendar-mcp",
      command: "npx",
      args: ["-y"],
    },
    refreshable: true,
    materialized_path: "/tmp/mcp/calendar/server.yml",
    assignment_count: 1,
    transport: "stdio",
  };
}

function createManagedMcpDetail(key: string) {
  return {
    ...createManagedMcpSummary(),
    key,
    manifest: null,
    spec: {
      id: key,
      name: "Calendar MCP",
      enabled: true,
      transport: "stdio" as const,
      command: "npx",
      args: ["-y", "@scope/calendar-mcp"],
    },
    files: ["server.yml"],
    revisions: [
      {
        revision: 1,
        enabled: true,
        created_at: "2026-03-01T00:00:00.000Z",
        reason: null,
        reverted_from_revision: null,
      },
    ],
  };
}

function createManagedAgentList() {
  return {
    agents: [
      {
        agent_key: "default",
        agent_id: "11111111-1111-4111-8111-111111111111",
        can_delete: false,
        persona: { name: "Default Agent" },
      },
      {
        agent_key: "agent-1",
        agent_id: "22222222-2222-4222-8222-222222222222",
        can_delete: true,
        persona: { name: "Agent One" },
      },
    ],
  };
}

export function createHarnessAgentHttpFixtures(createManagedAgentDetail: (agentKey: string) => unknown) {
  const getManagedExtensionDetail = (kind: "skill" | "mcp", key: string) =>
    kind === "skill" ? createManagedSkillDetail(key) : createManagedMcpDetail(key);

  return {
    agents: {
      list: async () => createManagedAgentList(),
      get: async (agentKey: string) => createManagedAgentDetail(agentKey),
      create: async () => createManagedAgentDetail("agent-1"),
      update: async (agentKey: string) => createManagedAgentDetail(agentKey),
      delete: async () => ({ deleted: true }),
    },
    extensions: {
      list: async (kind: "skill" | "mcp") => ({
        items: [kind === "skill" ? createManagedSkillSummary() : createManagedMcpSummary()],
      }),
      get: async (kind: "skill" | "mcp", key: string) => ({
        item: getManagedExtensionDetail(kind, key),
      }),
      importSkill: async () => ({
        item: createManagedSkillDetail("example-skill"),
      }),
      uploadSkill: async () => ({
        item: createManagedSkillDetail("example-skill"),
      }),
      importMcp: async () => ({
        item: createManagedMcpDetail("calendar"),
      }),
      uploadMcp: async () => ({
        item: createManagedMcpDetail("calendar"),
      }),
      toggle: async (kind: "skill" | "mcp", key: string) => ({
        item: getManagedExtensionDetail(kind, key),
      }),
      revert: async (kind: "skill" | "mcp", key: string) => ({
        item: getManagedExtensionDetail(kind, key),
      }),
      refresh: async (kind: "skill" | "mcp", key: string) => ({
        item: getManagedExtensionDetail(kind, key),
      }),
    },
  };
}
