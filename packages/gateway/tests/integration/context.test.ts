import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestApp } from "./helpers.js";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";

async function writeWorkspace(home: string): Promise<void> {
  await mkdir(join(home, "agents/default"), { recursive: true });
}

function usage() {
  return {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 5,
      text: 5,
      reasoning: undefined,
    },
  };
}

function createToolCallLanguageModel(input: {
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  finalReply: string;
}): MockLanguageModelV3 {
  let callCount = 0;

  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start" as const, id: "text-1" },
          { type: "text-delta" as const, id: "text-1", delta: input.finalReply },
          { type: "text-end" as const, id: "text-1" },
          {
            type: "finish" as const,
            finishReason: { unified: "stop" as const, raw: undefined },
            logprobs: undefined,
            usage: usage(),
          },
        ],
      }),
    }),
    doGenerate: async () => {
      callCount += 1;

      if (callCount === 1) {
        return {
          content: input.toolCalls.map((tc) => ({
            type: "tool-call" as const,
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.arguments,
          })),
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      }

      return {
        content: [{ type: "text" as const, text: input.finalReply }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: usage(),
        warnings: [],
      };
    },
  });
}

describe("/context", () => {
  let homeDir: string | undefined;
  const originalTyrumHome = process.env["TYRUM_HOME"];

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-context-"));
    await writeWorkspace(homeDir);
    await writeFile(join(homeDir, "agents/default/big.txt"), "a".repeat(40_000), "utf-8");
    process.env["TYRUM_HOME"] = homeDir;
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
    const { app, container, agents } = await createTestApp({
      tyrumHome: homeDir,
      languageModel: createToolCallLanguageModel({
        toolCalls: [
          {
            id: "tc-1",
            name: "read",
            arguments: JSON.stringify({ path: "big.txt" }),
          },
        ],
        finalReply: "ok",
      }),
    });

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
        system_prompt: { chars: number; sections?: Array<{ id: string; chars: number }> };
        user_parts: Array<{ id: string; chars: number }>;
        selected_tools: string[];
        tool_schema_total_chars?: number;
        tool_schema_top?: Array<{ id: string; chars: number }>;
        tool_calls?: Array<{ tool_call_id: string; tool_id: string; injected_chars: number }>;
        injected_files?: Array<{
          tool_call_id: string;
          path: string;
          raw_chars: number;
          injected_chars: number;
          truncated: boolean;
          truncation_marker?: string;
        }>;
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

    expect(ctxPayload.report!.system_prompt.sections?.length).toBeGreaterThan(0);
    expect(ctxPayload.report!.selected_tools).toContain("read");
    expect(ctxPayload.report!.tool_schema_total_chars).toBeGreaterThan(0);
    expect(ctxPayload.report!.tool_schema_top?.length).toBeGreaterThan(0);

    const fileReport = ctxPayload.report!.injected_files?.find((f) => f.path === "big.txt");
    expect(fileReport).toBeTruthy();
    expect(fileReport!.raw_chars).toBe(40_000);
    expect(fileReport!.injected_chars).toBeLessThan(fileReport!.raw_chars);
    expect(fileReport!.truncated).toBe(true);
    expect(fileReport!.truncation_marker).toBe("...(truncated)");

    expect(ctxPayload.report!.tool_calls?.some((c) => c.tool_id === "read")).toBe(true);

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

  it("returns 404 for /context/tools when the explicit agent scope does not exist", async () => {
    const { request, container, agents } = await createTestApp({
      tyrumHome: homeDir,
    });
    const tenantId = "00000000-0000-4000-8000-000000000001";
    const before = await container.db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );

    const response = await request("/context/tools?agent_key=missing-agent");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "not_found",
      message: "agent 'missing-agent' not found",
    });

    const after = await container.db.get<{ count: number }>(
      "SELECT COUNT(1) AS count FROM agents WHERE tenant_id = ?",
      [tenantId],
    );
    expect(after?.count ?? 0).toBe(before?.count ?? 0);

    await agents?.shutdown();
    await container.db.close();
  });
});
