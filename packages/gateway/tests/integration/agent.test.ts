import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../src/app.js";
import { createTestApp, createTestContainer } from "./helpers.js";
import { createStubLanguageModel } from "../unit/stub-language-model.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { buildAgentTurnKey } from "../../src/modules/agent/turn-key.js";

async function writeWorkspace(home: string): Promise<void> {
  await mkdir(home, { recursive: true });
  await mkdir(join(home, "skills/file-reader"), { recursive: true });
  await mkdir(join(home, "mcp/calendar"), { recursive: true });
  await mkdir(join(home, "memory"), { recursive: true });

  await writeFile(
    join(home, "agent.yml"),
    `model:
  model: openai/gpt-4.1
skills:
  enabled:
    - file-reader
  workspace_trusted: true
mcp:
  enabled:
    - calendar
tools:
  allow:
    - tool.fs.read
    - mcp.*
sessions:
  ttl_days: 30
  max_turns: 20
memory:
  markdown_enabled: true
`,
    "utf-8",
  );

  await writeFile(
    join(home, "IDENTITY.md"),
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

  await writeFile(
    join(home, "skills/file-reader/SKILL.md"),
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

  await writeFile(
    join(home, "mcp/calendar/server.yml"),
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
}

describe("agent routes", () => {
  let homeDir: string | undefined;
  const originalTyrumHome = process.env["TYRUM_HOME"];
  const originalAgentFlag = process.env["TYRUM_AGENT_ENABLED"];

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-"));
    await writeWorkspace(homeDir);
    process.env["TYRUM_HOME"] = homeDir;
    process.env["TYRUM_AGENT_ENABLED"] = "1";
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalTyrumHome === undefined) {
      delete process.env["TYRUM_HOME"];
    } else {
      process.env["TYRUM_HOME"] = originalTyrumHome;
    }

    if (originalAgentFlag === undefined) {
      delete process.env["TYRUM_AGENT_ENABLED"];
    } else {
      process.env["TYRUM_AGENT_ENABLED"] = originalAgentFlag;
    }

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("returns singleton status from local workspace", async () => {
    const { app, agents, container } = await createTestApp();
    const res = await app.request("/agent/status");

    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      enabled: boolean;
      identity: { name: string };
      skills: string[];
      skills_detailed?: Array<{ id: string; source: string }>;
      workspace_skills_trusted?: boolean;
      mcp: Array<{ id: string }>;
      tools: string[];
    };

    expect(payload.enabled).toBe(true);
    expect(payload.identity.name).toBe("Tyrum Local");
    expect(payload.skills).toEqual(["file-reader"]);
    expect(payload.workspace_skills_trusted).toBe(true);
    expect(payload.skills_detailed).toEqual([
      expect.objectContaining({ id: "file-reader", source: "workspace" }),
    ]);
    expect(payload.mcp.map((server) => server.id)).toEqual(["calendar"]);
    expect(payload.tools).toContain("tool.fs.read");

    await agents?.shutdown();
    await container.db.close();
  });

  it("lists available agents via /agent/list", async () => {
    await mkdir(join(homeDir!, "agents/agent-1"), { recursive: true });
    await writeWorkspace(join(homeDir!, "agents/agent-1"));

    const { app, agents, container } = await createTestApp();

    const res = await app.request("/agent/list");
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { agents: Array<{ agent_id: string }> };
    expect(payload.agents.map((a) => a.agent_id)).toEqual(["default", "agent-1"]);

    const resNoDefault = await app.request("/agent/list?include_default=false");
    expect(resNoDefault.status).toBe(200);
    const payloadNoDefault = (await resNoDefault.json()) as { agents: Array<{ agent_id: string }> };
    expect(payloadNoDefault.agents.map((a) => a.agent_id)).toEqual(["agent-1"]);

    await agents?.shutdown();
    await container.db.close();
  });

  it("accepts agent_key query param for /agent/status", async () => {
    await mkdir(join(homeDir!, "agents/agent-2"), { recursive: true });
    await writeWorkspace(join(homeDir!, "agents/agent-2"));

    const { app, agents, container } = await createTestApp();
    const getRuntimeSpy = vi.spyOn(agents!, "getRuntime");
    const res = await app.request("/agent/status?agent_key=agent-2");
    expect(res.status).toBe(200);
    expect(getRuntimeSpy).toHaveBeenCalledWith("agent-2");

    await agents?.shutdown();
    await container.db.close();
  });

  it("does not expose agent routes without an AgentRuntime", async () => {
    const container = await createTestContainer();
    const app = createApp(container);
    const res = await app.request("/agent/status");
    expect(res.status).toBe(404);
    await container.db.close();
  });

  it("separates short-term session context per channel/thread and writes memory files", async () => {
    const { app, container, agents } = await createTestApp({
      languageModel: createStubLanguageModel("ok"),
    });

    const first = await app.request("/agent/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "telegram",
        thread_id: "dm-1",
        message: "remember that I prefer tea",
      }),
    });
    expect(first.status).toBe(200);

    const second = await app.request("/agent/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "discord",
        thread_id: "dm-1",
        message: "what did I just say?",
      }),
    });
    expect(second.status).toBe(200);

    const third = await app.request("/agent/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "telegram",
        thread_id: "dm-1",
        message: "what do I prefer?",
      }),
    });
    expect(third.status).toBe(200);

    const telegramSessionKey = buildAgentTurnKey({
      agentId: "default",
      workspaceId: "default",
      channel: "telegram",
      containerKind: "channel",
      threadId: "dm-1",
    });
    const telegram = await container.sessionDal.getByKey({
      tenantId: DEFAULT_TENANT_ID,
      sessionKey: telegramSessionKey,
    });
    expect(telegram).toBeTruthy();
    const discordSessionKey = buildAgentTurnKey({
      agentId: "default",
      workspaceId: "default",
      channel: "discord",
      containerKind: "channel",
      threadId: "dm-1",
    });
    const discord = await container.sessionDal.getByKey({
      tenantId: DEFAULT_TENANT_ID,
      sessionKey: discordSessionKey,
    });
    expect(discord).toBeTruthy();

    const telegramUserTurns = telegram!.turns
      .filter((t) => t.role === "user")
      .map((t) => t.content);
    const discordUserTurns = discord!.turns.filter((t) => t.role === "user").map((t) => t.content);

    expect(discordUserTurns.join("\n").toLowerCase()).not.toContain("prefer tea");
    expect(telegramUserTurns.join("\n").toLowerCase()).toContain("prefer tea");

    const memoryFiles = await readdir(join(homeDir!, "memory"));
    expect(memoryFiles).toContain("MEMORY.md");
    expect(memoryFiles.some((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))).toBe(true);

    await agents?.shutdown();
    await container.db.close();
  });

  it("accepts envelope-only turns with attachments", async () => {
    const { app, container, agents } = await createTestApp({
      languageModel: createStubLanguageModel("ok"),
    });

    const res = await app.request("/agent/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        envelope: {
          message_id: "msg-1",
          received_at: "2025-10-05T16:31:09Z",
          delivery: {
            channel: "telegram",
            account: "default",
          },
          container: {
            kind: "dm",
            id: "dm-attach-1",
          },
          sender: {
            id: "user-42",
          },
          content: {
            attachments: [{ kind: "photo" }],
          },
          provenance: ["user"],
        },
      }),
    });

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { reply: string; session_id: string };
    expect(typeof payload.reply).toBe("string");
    expect(payload.session_id).toBeTruthy();

    await agents?.shutdown();
    await container.db.close();
  });
});
