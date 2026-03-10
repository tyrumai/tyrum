import { vi } from "vitest";

function createManagedSkillSummary() {
  return {
    kind: "skill" as const,
    key: "example-skill",
    name: "Example Skill",
    description: "Example managed skill",
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
      body: "Use the example workflow.",
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

export function createExtensionsHttpFixtures() {
  const getExtensionDetail = (kind: "skill" | "mcp", key: string) =>
    kind === "skill" ? createManagedSkillDetail(key) : createManagedMcpDetail(key);

  return {
    list: vi.fn(async (kind: "skill" | "mcp") => ({
      items: [kind === "skill" ? createManagedSkillSummary() : createManagedMcpSummary()],
    })),
    get: vi.fn(async (kind: "skill" | "mcp", key: string) => ({
      item: getExtensionDetail(kind, key),
    })),
    importSkill: vi.fn(async () => ({
      item: createManagedSkillDetail("example-skill"),
    })),
    uploadSkill: vi.fn(async () => ({
      item: createManagedSkillDetail("example-skill"),
    })),
    importMcp: vi.fn(async () => ({
      item: createManagedMcpDetail("calendar"),
    })),
    uploadMcp: vi.fn(async () => ({
      item: createManagedMcpDetail("calendar"),
    })),
    toggle: vi.fn(async (kind: "skill" | "mcp", key: string) => ({
      item: getExtensionDetail(kind, key),
    })),
    revert: vi.fn(async (kind: "skill" | "mcp", key: string) => ({
      item: getExtensionDetail(kind, key),
    })),
    refresh: vi.fn(async (kind: "skill" | "mcp", key: string) => ({
      item: getExtensionDetail(kind, key),
    })),
  };
}
