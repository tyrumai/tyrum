import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestApp } from "./helpers.js";

async function writeWorkspace(home: string): Promise<void> {
  await mkdir(home, { recursive: true });
  await mkdir(join(home, "skills/file-reader"), { recursive: true });
  await mkdir(join(home, "mcp/calendar"), { recursive: true });
  await mkdir(join(home, "memory"), { recursive: true });

  await writeFile(
    join(home, "agent.yml"),
    `model:
  model: frontier-gpt-4o
  base_url: http://llm.test/v1
skills:
  enabled:
    - file-reader
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

function findSessionPrompt(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const messages = (payload as Record<string, unknown>)["messages"];
  if (!Array.isArray(messages)) {
    return "";
  }
  for (const message of messages) {
    if (
      message &&
      typeof message === "object" &&
      (message as Record<string, unknown>)["role"] === "developer" &&
      typeof (message as Record<string, unknown>)["content"] === "string" &&
      ((message as Record<string, unknown>)["content"] as string).startsWith(
        "Session context:",
      )
    ) {
      return (message as Record<string, unknown>)["content"] as string;
    }
  }
  return "";
}

describe("agent routes", () => {
  let homeDir: string | undefined;
  const originalTyrumHome = process.env["TYRUM_HOME"];
  const originalAgentFlag = process.env["TYRUM_AGENT_ENABLED"];
  const originalGatewayHost = process.env["GATEWAY_HOST"];
  const originalGatewayPort = process.env["GATEWAY_PORT"];

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-"));
    await writeWorkspace(homeDir);
    process.env["TYRUM_HOME"] = homeDir;
    process.env["TYRUM_AGENT_ENABLED"] = "1";
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalGatewayHost === undefined) {
      delete process.env["GATEWAY_HOST"];
    } else {
      process.env["GATEWAY_HOST"] = originalGatewayHost;
    }

    if (originalGatewayPort === undefined) {
      delete process.env["GATEWAY_PORT"];
    } else {
      process.env["GATEWAY_PORT"] = originalGatewayPort;
    }
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
    const { app } = createTestApp();
    const res = await app.request("/agent/status");

    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      enabled: boolean;
      identity: { name: string };
      skills: string[];
      mcp: Array<{ id: string }>;
      tools: string[];
    };

    expect(payload.enabled).toBe(true);
    expect(payload.identity.name).toBe("Tyrum Local");
    expect(payload.skills).toEqual(["file-reader"]);
    expect(payload.mcp.map((server) => server.id)).toEqual(["calendar"]);
    expect(payload.tools).toContain("tool.fs.read");
  });

  it("separates short-term session context per channel/thread and writes memory files", async () => {
    const capturedPayloads: unknown[] = [];
    const responses = [
      "First response",
      "Second response",
      "Third response",
    ];

    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : "{}";
      capturedPayloads.push(JSON.parse(body) as unknown);
      const text = responses[Math.min(capturedPayloads.length - 1, responses.length - 1)]!;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: text,
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { app } = createTestApp();

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

    expect(capturedPayloads).toHaveLength(3);
    const secondPrompt = findSessionPrompt(capturedPayloads[1]);
    const thirdPrompt = findSessionPrompt(capturedPayloads[2]);

    expect(secondPrompt.toLowerCase()).not.toContain("prefer tea");
    expect(thirdPrompt.toLowerCase()).toContain("prefer tea");

    const memoryFiles = await readdir(join(homeDir!, "memory"));
    expect(memoryFiles).toContain("MEMORY.md");
    expect(memoryFiles.some((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))).toBe(true);
  });

  it("normalizes bind-all host when deriving default model base url", async () => {
    process.env["GATEWAY_HOST"] = "0.0.0.0";
    process.env["GATEWAY_PORT"] = "8080";

    await writeFile(
      join(homeDir!, "agent.yml"),
      `model:\n  model: frontier-gpt-4o\nskills:\n  enabled: []\nmcp:\n  enabled: []\ntools:\n  allow:\n    - tool.fs.read\nsessions:\n  ttl_days: 30\n  max_turns: 20\nmemory:\n  markdown_enabled: false\n`,
      "utf-8",
    );

    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe("http://127.0.0.1:8080/v1/chat/completions");
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { app } = createTestApp();
    const res = await app.request("/agent/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "telegram",
        thread_id: "dm-1",
        message: "hello",
      }),
    });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });
});
