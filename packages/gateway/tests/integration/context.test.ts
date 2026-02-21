import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestApp } from "./helpers.js";

async function writeWorkspace(home: string): Promise<void> {
  await writeFile(
    join(home, "agent.yml"),
    `model:
  model: frontier-gpt-4o
  base_url: http://llm.test/v1
skills:
  enabled: []
mcp:
  enabled: []
tools:
  allow: []
sessions:
  ttl_days: 30
  max_turns: 20
memory:
  markdown_enabled: false
`,
    "utf-8",
  );

  await writeFile(
    join(home, "IDENTITY.md"),
    `---
name: Tyrum Test
description: test identity
---
You are a concise test assistant.
`,
    "utf-8",
  );
}

describe("/context", () => {
  let homeDir: string | undefined;
  const originalTyrumHome = process.env["TYRUM_HOME"];

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-context-"));
    await writeWorkspace(homeDir);
    process.env["TYRUM_HOME"] = homeDir;

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "ok",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalTyrumHome === undefined) {
      delete process.env["TYRUM_HOME"];
    } else {
      process.env["TYRUM_HOME"] = originalTyrumHome;
    }
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("returns last-known context report metadata after an agent turn", async () => {
    const { app, container, agents } = await createTestApp();

    const turnRes = await app.request("/agent/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: "telegram",
        thread_id: "dm-1",
        message: "hello",
      }),
    });
    expect(turnRes.status).toBe(200);
    const turnPayload = (await turnRes.json()) as { session_id: string };

    const ctxRes = await app.request("/context");
    expect(ctxRes.status).toBe(200);
    const ctxPayload = (await ctxRes.json()) as {
      status: string;
      report: null | {
        session_id: string;
        channel: string;
        thread_id: string;
        system_prompt: { chars: number };
        user_parts: Array<{ id: string; chars: number }>;
      };
    };

    expect(ctxPayload.status).toBe("ok");
    expect(ctxPayload.report).toBeTruthy();
    expect(ctxPayload.report!.session_id).toBe(turnPayload.session_id);
    expect(ctxPayload.report!.channel).toBe("telegram");
    expect(ctxPayload.report!.thread_id).toBe("dm-1");
    expect(ctxPayload.report!.system_prompt.chars).toBeGreaterThan(10);

    const messagePart = ctxPayload.report!.user_parts.find((p) => p.id === "message");
    expect(messagePart).toEqual({ id: "message", chars: "hello".length });

    const listRes = await app.request("/context/list");
    expect(listRes.status).toBe(200);
    const listPayload = (await listRes.json()) as {
      status: string;
      reports: Array<{ context_report_id: string; session_id: string }>;
    };
    expect(listPayload.status).toBe("ok");
    expect(listPayload.reports.length).toBeGreaterThan(0);
    expect(listPayload.reports[0]!.session_id).toBe(turnPayload.session_id);

    const reportId = listPayload.reports[0]!.context_report_id;
    const detailRes = await app.request(`/context/detail/${reportId}`);
    expect(detailRes.status).toBe(200);
    const detailPayload = (await detailRes.json()) as {
      status: string;
      report: { context_report_id: string };
    };
    expect(detailPayload.status).toBe("ok");
    expect(detailPayload.report.context_report_id).toBe(reportId);

    await agents?.shutdown();
    await container.db.close();
  });
});
