import { afterEach, describe, expect, it, vi } from "vitest";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import type { ApprovalRow } from "../../src/modules/approval/dal.js";
import { createApprovalRoutes } from "../../src/routes/approval.js";
import { Hono } from "hono";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { createStubLanguageModel } from "../unit/stub-language-model.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

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

function createToolLoopLanguageModel(input: {
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  finalReply: string;
  mode?: "once" | "infinite";
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

      const shouldReturnToolCalls = input.mode === "infinite" || callCount === 1;
      if (shouldReturnToolCalls) {
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

type ToolLoopStep =
  | { kind: "tool-calls"; toolCalls: Array<{ id: string; name: string; arguments: string }> }
  | { kind: "text"; text: string };

function createSequencedToolLoopLanguageModel(
  steps: readonly ToolLoopStep[],
): MockLanguageModelV3 {
  let callCount = 0;

  const getStep = (): ToolLoopStep => {
    const step = steps[callCount] ?? steps.at(-1);
    if (!step) {
      return { kind: "text", text: "" };
    }
    return step;
  };

  return new MockLanguageModelV3({
    doGenerate: async () => {
      const step = getStep();
      callCount += 1;

      if (step.kind === "tool-calls") {
        return {
          content: step.toolCalls.map((tc) => ({
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
        content: [{ type: "text" as const, text: step.text }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: usage(),
        warnings: [],
      };
    },
  });
}

async function waitForPendingApproval(
  container: GatewayContainer,
  timeoutMs = 5_000,
): Promise<ApprovalRow> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pending = await container.approvalDal.getPending();
    if (pending.length > 0) {
      return pending[0]!;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for pending approval");
}

describe("Tool execution loop", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("executes tool calls and returns the final reply", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-tool-loop-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    // Create a file for tool.fs.read to read
    await writeFile(join(homeDir, "notes.txt"), "important notes", "utf-8");

    // Write agent config that allows tool.fs.read
    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: openai/gpt-4.1",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow:",
        "    - tool.fs.read",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    const languageModel = createToolLoopLanguageModel({
      toolCalls: [
        {
          id: "tc-1",
          name: "tool.fs.read",
          arguments: JSON.stringify({ path: "notes.txt" }),
        },
      ],
      finalReply: "I read the file, it says: important notes",
    });

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "read the notes file",
    });

    expect(result.reply).toBe("I read the file, it says: important notes");
    expect(result.used_tools).toContain("tool.fs.read");
  });

  it("queues high-risk tool calls and resumes after approval", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-tool-loop-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: openai/gpt-4.1",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow:",
        "    - tool.exec",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    const languageModel = createToolLoopLanguageModel({
      toolCalls: [
        {
          id: "tc-approve",
          name: "tool.exec",
          arguments: JSON.stringify({ command: "echo approved" }),
        },
      ],
      finalReply: "approved and executed",
    });

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      agentId: "agent-test",
      workspaceId: "ws-test",
      languageModel,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-approval-1",
      message: "run command",
    });

    const pending = await waitForPendingApproval(container);
    expect(pending.prompt).toContain("tool.exec");
    expect(pending.kind).toBe("workflow_step");
    expect(pending.agent_id).toBe("agent-test");
    expect(pending.workspace_id).toBe("ws-test");
    expect(pending.status).toBe("pending");

    const updated = await container.approvalDal.respond(
      pending.id,
      true,
      "approved in test",
    );
    expect(updated?.status).toBe("approved");

    const result = await turnPromise;
    expect(result.reply).toBe("approved and executed");
    expect(result.used_tools).toContain("tool.exec");
  });

  it("requires approval for tool.exec when driven by untrusted tool output", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-tool-loop-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    // Avoid relying on real DNS in CI by using an IP literal (still tagged as untrusted web content).
    const fetchUrl = "https://93.184.216.34";

    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: openai/gpt-4.1",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow:",
        "    - tool.http.fetch",
        "    - tool.exec",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    const bundlePath = join(homeDir, "policy.yml");
    await writeFile(
      bundlePath,
      [
        "v: 1",
        "tools:",
        "  default: deny",
        "  allow:",
        "    - tool.http.fetch",
        "    - tool.exec",
        "  require_approval: []",
        "  deny: []",
        "network_egress:",
        "  default: deny",
        "  allow:",
        `    - "${fetchUrl}/*"`,
        "  require_approval: []",
        "  deny: []",
        "provenance:",
        "  untrusted_shell_requires_approval: true",
        "",
      ].join("\n"),
      "utf-8",
    );

    const prevBundlePath = process.env["TYRUM_POLICY_BUNDLE_PATH"];
    process.env["TYRUM_POLICY_BUNDLE_PATH"] = bundlePath;

    try {
      const languageModel = createSequencedToolLoopLanguageModel([
        {
          kind: "tool-calls",
          toolCalls: [
            {
              id: "tc-fetch",
              name: "tool.http.fetch",
              arguments: JSON.stringify({ url: fetchUrl }),
            },
          ],
        },
        {
          kind: "tool-calls",
          toolCalls: [
            {
              id: "tc-exec",
              name: "tool.exec",
              arguments: JSON.stringify({ command: "echo ok" }),
            },
          ],
        },
        { kind: "text", text: "done" },
      ]);

      const fetchStub = vi.fn(async (url: string | URL | Request) => {
        const resolved = typeof url === "string" ? url : url.toString();
        if (resolved !== fetchUrl) {
          return new Response("not found", { status: 404 });
        }
        return new Response("example.com content", { status: 200 });
      }) as typeof fetch;

      const mcpManager = {
        listToolDescriptors: vi.fn(async () => []),
        shutdown: vi.fn(async () => {}),
        callTool: vi.fn(async () => ({ content: [] })),
      };

      const runtime = new AgentRuntime({
        container,
        home: homeDir,
        languageModel,
        fetchImpl: fetchStub,
        mcpManager: mcpManager as unknown as ConstructorParameters<
          typeof AgentRuntime
        >[0]["mcpManager"],
        approvalWaitMs: 10_000,
        approvalPollMs: 20,
      });

      const turnPromise = runtime.turn({
        channel: "test",
        thread_id: "thread-provenance-1",
        message: "fetch example.com then run a command",
      });

      const pending = await waitForPendingApproval(container);
      expect(pending.prompt).toContain("tool.exec");

      await container.approvalDal.respond(pending.id, true, "approved in test");

      const result = await turnPromise;
      expect(result.reply).toBe("done");
      expect(result.used_tools).toContain("tool.http.fetch");
      expect(result.used_tools).toContain("tool.exec");
    } finally {
      if (prevBundlePath === undefined) {
        delete process.env["TYRUM_POLICY_BUNDLE_PATH"];
      } else {
        process.env["TYRUM_POLICY_BUNDLE_PATH"] = prevBundlePath;
      }
    }
  }, 10_000);

  it("does not execute high-risk tool when approval is denied", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-tool-loop-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: openai/gpt-4.1",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow:",
        "    - tool.fs.write",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    const languageModel = createToolLoopLanguageModel({
      toolCalls: [
        {
          id: "tc-deny",
          name: "tool.fs.write",
          arguments: JSON.stringify({ path: "blocked.txt", content: "secret" }),
        },
      ],
      finalReply: "approval denied",
    });

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-approval-2",
      message: "write blocked file",
    });

    const pending = await waitForPendingApproval(container);
    const updated = await container.approvalDal.respond(
      pending.id,
      false,
      "denied in test",
    );
    expect(updated?.status).toBe("denied");

    const result = await turnPromise;
    expect(result.reply).toBe("approval denied");
    expect(result.used_tools).not.toContain("tool.fs.write");
    await expect(access(join(homeDir, "blocked.txt"))).rejects.toThrow();
  });

  it("supports approve-always by creating a policy override that skips future approvals", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-tool-loop-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: openai/gpt-4.1",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow:",
        "    - tool.exec",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    const toolCalls = [
      {
        id: "tc-always",
        name: "tool.exec",
        arguments: JSON.stringify({ command: "echo hello" }),
      },
    ];

    const languageModel1 = createToolLoopLanguageModel({
      toolCalls,
      finalReply: "approved and executed",
    });
    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

    const runtime1 = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: languageModel1,
      mcpManager: mcpManager as unknown as ConstructorParameters<typeof AgentRuntime>[0]["mcpManager"],
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const turn1Promise = runtime1.turn({
      channel: "test",
      thread_id: "thread-always-1",
      message: "run command",
    });

    const pending = await waitForPendingApproval(container);
    expect(pending.prompt).toContain("tool.exec");

    const approvalApp = new Hono();
    approvalApp.route(
      "/",
      createApprovalRoutes({
        approvalDal: container.approvalDal,
        policyOverrideDal: container.policyOverrideDal,
      }),
    );

    const suggested = (pending.context as { policy?: { suggested_overrides?: unknown[] } }).policy?.suggested_overrides;
    expect(Array.isArray(suggested)).toBe(true);

    const res = await approvalApp.request(`/approvals/${pending.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decision: "approved",
        mode: "always",
        overrides: [{ tool_id: "tool.exec", pattern: "echo hello", workspace_id: "default" }],
      }),
    });
    expect(res.status).toBe(200);

    const result1 = await turn1Promise;
    expect(result1.reply).toBe("approved and executed");
    expect(result1.used_tools).toContain("tool.exec");

    const overrides = await container.policyOverrideDal.list({ agentId: "default", toolId: "tool.exec" });
    expect(overrides.length).toBeGreaterThan(0);

    const languageModel2 = createToolLoopLanguageModel({
      toolCalls,
      finalReply: "executed without approval",
    });
    const runtime2 = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: languageModel2,
      mcpManager: mcpManager as unknown as ConstructorParameters<typeof AgentRuntime>[0]["mcpManager"],
      approvalWaitMs: 1_000,
      approvalPollMs: 20,
    });

    const turn2Promise = runtime2.turn({
      channel: "test",
      thread_id: "thread-always-2",
      message: "run command again",
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    const stillPending = await container.approvalDal.getPending();
    expect(stillPending).toHaveLength(0);

    const result2 = await turn2Promise;
    expect(result2.reply).toBe("executed without approval");
    expect(result2.used_tools).toContain("tool.exec");
  });

  it("returns final reply when LLM returns no tool_calls (single-shot)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-tool-loop-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    const languageModel = createStubLanguageModel("just a reply");

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-2",
      message: "hello",
    });

    expect(result.reply).toBe("just a reply");
    expect(result.used_tools).toEqual([]);
  });

  it("populates used_tools across multiple tool calls", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-tool-loop-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    await writeFile(join(homeDir, "a.txt"), "file A", "utf-8");

    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: openai/gpt-4.1",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow:",
        "    - tool.fs.read",
        "    - tool.http.fetch",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    const languageModel = createToolLoopLanguageModel({
      toolCalls: [
        { id: "tc-1", name: "tool.fs.read", arguments: JSON.stringify({ path: "a.txt" }) },
        { id: "tc-2", name: "tool.http.fetch", arguments: JSON.stringify({ url: "https://example.com" }) },
      ],
      finalReply: "done with both tools",
    });

    const fetchStub = vi.fn(async (url: string | URL | Request) => {
      const resolved = typeof url === "string" ? url : url.toString();
      if (resolved !== "https://example.com") {
        return new Response("not found", { status: 404 });
      }
      return new Response("example.com content", { status: 200 });
    }) as typeof fetch;

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      fetchImpl: fetchStub,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const autoApproveTimer = setInterval(() => {
      void (async () => {
        const c = container;
        if (!c) return;
        const pending = await c.approvalDal.getPending();
        for (const approval of pending) {
          await c.approvalDal.respond(approval.id, true, "approved in test");
        }
      })().catch(() => {
        // ignore (tests may tear down while timer is running)
      });
    }, 20);
    autoApproveTimer.unref();

    let result: Awaited<ReturnType<AgentRuntime["turn"]>>;
    try {
      result = await runtime.turn({
        channel: "test",
        thread_id: "thread-3",
        message: "read a file and fetch a url",
      });
    } finally {
      clearInterval(autoApproveTimer);
    }

    expect(result.reply).toBe("done with both tools");
    expect(result.used_tools).toContain("tool.fs.read");
    expect(result.used_tools).toContain("tool.http.fetch");
    expect(result.used_tools).toHaveLength(2);
  });

  it("respects maxSteps and stops looping", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-tool-loop-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir });

    await writeFile(
      join(homeDir, "agent.yml"),
      [
        "model:",
        "  model: openai/gpt-4.1",
        "skills:",
        "  enabled: []",
        "mcp:",
        "  enabled: []",
        "tools:",
        "  allow:",
        "    - tool.exec",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    const languageModel = createToolLoopLanguageModel({
      toolCalls: [
        {
          id: "tc-loop",
          name: "tool.exec",
          arguments: JSON.stringify({ command: "echo hi" }),
        },
      ],
      finalReply: "ignored",
      mode: "infinite",
    });

    const mcpManager = {
      listToolDescriptors: vi.fn(async () => []),
      shutdown: vi.fn(async () => {}),
      callTool: vi.fn(async () => ({ content: [] })),
    };

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
      maxSteps: 3,
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const autoApproveTimer = setInterval(() => {
      void (async () => {
        const c = container;
        if (!c) return;
        const pending = await c.approvalDal.getPending();
        for (const approval of pending) {
          await c.approvalDal.respond(approval.id, true, "approved in test");
        }
      })().catch(() => {
        // ignore (tests may tear down while timer is running)
      });
    }, 20);
    autoApproveTimer.unref();

    let result: Awaited<ReturnType<AgentRuntime["turn"]>>;
    try {
      result = await runtime.turn({
        channel: "test",
        thread_id: "thread-4",
        message: "run something",
      });
    } finally {
      clearInterval(autoApproveTimer);
    }

    // Should stop after maxSteps and return the default "No assistant response"
    expect(result.reply).toBe("No assistant response returned.");
    expect(result.used_tools).toContain("tool.exec");
  });
});
