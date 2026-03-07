import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentConfig } from "@tyrum/schemas";
import { createLocalAgentContextStore } from "../../src/modules/agent/context-store.js";

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
