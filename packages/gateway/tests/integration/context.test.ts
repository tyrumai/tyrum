import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SECRET_CLIPBOARD_TOOL_ID } from "../../src/modules/agent/tool-secret-definitions.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { createTestApp } from "./helpers.js";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { seedAgentConfig } from "../unit/agent-runtime.test-helpers.js";

vi.mock("../../src/modules/models/provider-factory.js", () => ({
  createProviderFromNpm: (input: { providerId: string }) => ({
    languageModel(modelId: string) {
      return {
        specificationVersion: "v3",
        provider: input.providerId,
        modelId,
        supportedUrls: {},
        async doGenerate() {
          return { text: "ok" } as never;
        },
        async doStream() {
          throw new Error("not implemented");
        },
      };
    },
  }),
}));

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
        parts: [{ type: "text", text: "hello" }],
      }),
    });
    expect(turnRes.status).toBe(200);
    const turnPayload = (await turnRes.json()) as { conversation_id: string };

    const ctxRes = await app.request("/context");
    expect(ctxRes.status).toBe(200);
    const ctxPayload = (await ctxRes.json()) as {
      status: string;
      report: null | {
        conversation_id: string;
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
    expect(ctxPayload.report!.conversation_id).toBe(turnPayload.conversation_id);
    expect(ctxPayload.report!.channel).toBe("telegram");
    expect(ctxPayload.report!.thread_id).toBe("dm-1");
    expect(ctxPayload.report!.system_prompt.chars).toBeGreaterThan(10);

    const messagePart = ctxPayload.report!.user_parts.find((p) => p.id === "user_request");
    expect(messagePart).toEqual({ id: "user_request", chars: "hello".length });

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
      reports: Array<{ context_report_id: string; conversation_id: string }>;
    };
    expect(listPayload.status).toBe("ok");
    expect(listPayload.reports.length).toBeGreaterThan(0);
    expect(listPayload.reports[0]!.conversation_id).toBe(turnPayload.conversation_id);

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

  it("matches runtime inventory exposure and taxonomy for omitted interaction inspection", async () => {
    const { request, container, agents } = await createTestApp({
      tyrumHome: homeDir,
    });
    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { default_mode: "allow", workspace_trusted: true },
        mcp: {
          default_mode: "allow",
          allow: [],
          deny: [],
        },
        tools: {
          default_mode: "allow",
          allow: [SECRET_CLIPBOARD_TOOL_ID],
          deny: [],
        },
        secret_refs: [
          {
            secret_ref_id: "secret-ref-1",
            secret_alias: "desktop-login",
            allowed_tool_ids: [SECRET_CLIPBOARD_TOOL_ID],
          },
        ],
      },
    });

    const runtime = await agents!.getRuntime({
      tenantId: DEFAULT_TENANT_ID,
      agentKey: "default",
    });
    const catalog = (await runtime.listRegisteredTools({
      executionProfile: "interaction",
    })) as Awaited<ReturnType<typeof runtime.listRegisteredTools>> & {
      inventory: Array<{
        descriptor: { id: string; taxonomy?: { canonicalId?: string } };
        enabled: boolean;
        reason: string;
      }>;
    };

    const response = await request("/context/tools?agent_key=default");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      tools: Array<{
        canonical_id: string;
        lifecycle: string;
        visibility: string;
        aliases: Array<{ id: string; lifecycle: string }>;
        effective_exposure: {
          enabled: boolean;
          reason: string;
        };
      }>;
    };
    expect(body.status).toBe("ok");
    expect(body).not.toHaveProperty("allowlist");
    expect(body).not.toHaveProperty("mcp_servers");

    const routeToolIds = body.tools.map((tool) => tool.canonical_id).toSorted();
    const runtimeInventoryIds = catalog.inventory
      .map((entry) => entry.descriptor.taxonomy?.canonicalId ?? entry.descriptor.id)
      .toSorted();
    expect(routeToolIds).toEqual(runtimeInventoryIds);
    expect(routeToolIds).toContain(SECRET_CLIPBOARD_TOOL_ID);

    const routeExposureById = new Map(
      body.tools.map((tool) => [tool.canonical_id, tool.effective_exposure] as const),
    );
    for (const entry of catalog.inventory) {
      expect(
        routeExposureById.get(entry.descriptor.taxonomy?.canonicalId ?? entry.descriptor.id),
      ).toMatchObject({
        enabled: entry.enabled,
        reason: entry.reason,
      });
    }

    expect(body.tools).toContainEqual(
      expect.objectContaining({
        canonical_id: "read",
        lifecycle: "canonical",
        visibility: "public",
        aliases: [{ id: "tool.fs.read", lifecycle: "alias" }],
      }),
    );

    await agents?.shutdown();
    await container.db.close();
  });

  it("matches runtime inventory for explicit subagent execution_profile inspection", async () => {
    const { request, container, agents } = await createTestApp({
      tyrumHome: homeDir,
    });
    await seedAgentConfig(container, {
      config: {
        model: { model: "openai/gpt-4.1" },
        skills: { enabled: [] },
        mcp: {
          enabled: [],
          server_settings: { memory: { enabled: false } },
        },
        tools: {
          allow: ["read", "write", "bash"],
        },
        conversations: { ttl_days: 30, max_turns: 20 },
      },
    });

    const runtime = await agents!.getRuntime({
      tenantId: DEFAULT_TENANT_ID,
      agentKey: "default",
    });
    const explorerCatalog = (await runtime.listRegisteredTools({
      executionProfile: "explorer_ro",
    })) as Awaited<ReturnType<typeof runtime.listRegisteredTools>> & {
      inventory: Array<{
        descriptor: { id: string; taxonomy?: { canonicalId?: string } };
        enabled: boolean;
        reason: string;
      }>;
    };

    const response = await request(
      "/context/tools?agent_key=default&execution_profile=explorer_ro",
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      tools: Array<{
        canonical_id: string;
        effective_exposure: {
          enabled: boolean;
          reason: string;
        };
      }>;
    };

    const routeExposureById = new Map(
      body.tools.map((tool) => [tool.canonical_id, tool.effective_exposure] as const),
    );
    for (const entry of explorerCatalog.inventory) {
      expect(
        routeExposureById.get(entry.descriptor.taxonomy?.canonicalId ?? entry.descriptor.id),
      ).toMatchObject({
        enabled: entry.enabled,
        reason: entry.reason,
      });
    }

    expect(routeExposureById.get("write")).toMatchObject({
      enabled: false,
      reason: "disabled_by_execution_profile",
    });
    expect(routeExposureById.get("bash")).toMatchObject({
      enabled: false,
      reason: "disabled_by_execution_profile",
    });
    expect(routeExposureById.get("read")).toMatchObject({
      enabled: true,
      reason: "enabled",
    });

    await agents?.shutdown();
    await container.db.close();
  });
});
