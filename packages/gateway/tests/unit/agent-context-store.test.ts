import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentConfig } from "@tyrum/schemas";
import { createContainer } from "../../src/container.js";
import {
  createLocalAgentContextStore,
  createSharedAgentContextStore,
} from "../../src/modules/agent/context-store.js";
import { DEFAULT_WORKSPACE_KEY } from "../../src/modules/identity/scope.js";

const migrationsDir = join(import.meta.dirname, "../../migrations/sqlite");

describe("LocalAgentContextStore", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "tyrum-agent-context-store-"));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("loads identity, skills, mcp, and markdown memory from the local workspace", async () => {
    await mkdir(join(homeDir, "skills/file-reader"), { recursive: true });
    await mkdir(join(homeDir, "mcp/calendar"), { recursive: true });

    writeFileSync(
      join(homeDir, "IDENTITY.md"),
      `---
name: Tyrum Local
description: local identity
style:
  tone: direct
---
You are a precise local assistant.
`,
      "utf-8",
    );
    writeFileSync(
      join(homeDir, "skills/file-reader/SKILL.md"),
      `---
id: file-reader
name: File Reader
version: 1.0.0
description: Read local files.
---
Always inspect files before proposing changes.
`,
      "utf-8",
    );
    writeFileSync(
      join(homeDir, "mcp/calendar/server.yml"),
      `id: calendar
name: Calendar MCP
enabled: true
transport: stdio
command: node
args:
  - ./calendar.mjs
`,
      "utf-8",
    );

    const store = createLocalAgentContextStore({ home: homeDir });
    const scope = { tenantId: "tenant-1", agentId: "agent-1", workspaceId: "workspace-1" };
    const config = AgentConfig.parse({
      model: { model: "openai/gpt-4.1" },
      skills: { enabled: ["file-reader"], workspace_trusted: true },
      mcp: { enabled: ["calendar"] },
      memory: { markdown_enabled: true },
    });

    await store.ensureAgentContext(scope);

    const identity = await store.getIdentity(scope);
    const skills = await store.getEnabledSkills(scope, config);
    const mcpServers = await store.getEnabledMcpServers(scope, config);
    const memoryStore = store.createMemoryStore(scope);
    await memoryStore.ensureInitialized();
    await memoryStore.appendToCoreSection("Learned Preferences", "- prefers tea");
    const hits = await memoryStore.search("tea", 5);

    expect(identity.meta.name).toBe("Tyrum Local");
    expect(skills.map((skill) => skill.meta.id)).toEqual(["file-reader"]);
    expect(mcpServers.map((server) => server.id)).toEqual(["calendar"]);
    expect(hits.some((hit) => hit.snippet.includes("tea"))).toBe(true);
  });
});

describe("SharedAgentContextStore", () => {
  it("loads identity, skills, mcp, and markdown memory from shared state", async () => {
    const container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: { state: { mode: "shared" } } },
    );

    const tenantId = await container.identityScopeDal.ensureTenantId("tenant-shared");
    const agentId = await container.identityScopeDal.ensureAgentId(tenantId, "shared-agent");
    const workspaceId = await container.identityScopeDal.ensureWorkspaceId(
      tenantId,
      DEFAULT_WORKSPACE_KEY,
    );
    await container.identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);

    const store = createSharedAgentContextStore({
      db: container.db,
      logger: container.logger,
    });
    const scope = { tenantId, agentId, workspaceId };
    const config = AgentConfig.parse({
      model: { model: "openai/gpt-4.1" },
      skills: { enabled: ["db-skill"], workspace_trusted: false },
      mcp: { enabled: ["calendar"] },
      memory: { markdown_enabled: true },
    });

    await container.db.run(
      `INSERT INTO agent_identity_revisions (
         tenant_id, agent_id, identity_json, created_at, created_by_json, reason
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        agentId,
        JSON.stringify({
          meta: { name: "Tyrum Shared", description: "shared identity" },
          body: "You are the shared runtime identity.",
        }),
        new Date().toISOString(),
        JSON.stringify({ kind: "test" }),
        "seed",
      ],
    );
    await container.db.run(
      `INSERT INTO runtime_package_revisions (
         tenant_id, package_kind, package_key, package_json, artifact_id, enabled, created_at, created_by_json, reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        "skill",
        "db-skill",
        JSON.stringify({
          meta: {
            id: "db-skill",
            name: "DB Skill",
            version: "1.0.0",
            description: "Loaded from shared state.",
          },
          body: "Prefer shared-state skills over local workspace skills.",
        }),
        null,
        1,
        new Date().toISOString(),
        JSON.stringify({ kind: "test" }),
        "seed",
      ],
    );
    await container.db.run(
      `INSERT INTO runtime_package_revisions (
         tenant_id, package_kind, package_key, package_json, artifact_id, enabled, created_at, created_by_json, reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantId,
        "mcp",
        "calendar",
        JSON.stringify({
          id: "calendar",
          name: "Calendar MCP",
          enabled: true,
          transport: "remote",
          url: "https://example.com/mcp",
        }),
        null,
        1,
        new Date().toISOString(),
        JSON.stringify({ kind: "test" }),
        "seed",
      ],
    );

    await store.ensureAgentContext(scope);

    const identity = await store.getIdentity(scope);
    const skills = await store.getEnabledSkills(scope, config);
    const mcpServers = await store.getEnabledMcpServers(scope, config);
    const memoryStore = store.createMemoryStore(scope);
    await memoryStore.ensureInitialized();
    await memoryStore.appendToCoreSection("Learned Preferences", "- prefers coffee");
    const hits = await memoryStore.search("coffee", 5);

    expect(identity.meta.name).toBe("Tyrum Shared");
    expect(skills.map((skill) => [skill.meta.id, skill.provenance.source])).toEqual([
      ["db-skill", "shared"],
    ]);
    expect(mcpServers.map((server) => server.id)).toEqual(["calendar"]);
    expect(hits.some((hit) => hit.snippet.includes("coffee"))).toBe(true);

    await container.db.close();
  });
});
