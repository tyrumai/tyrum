import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import type { ApprovalRow } from "../../src/modules/approval/dal.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import type { SecretHandle } from "@tyrum/schemas";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";

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

type ToolLoopStep =
  | { kind: "tool-calls"; toolCalls: Array<{ id: string; name: string; arguments: string }> }
  | { kind: "text"; text: string };

function createSequencedToolLoopLanguageModel(steps: readonly ToolLoopStep[]): MockLanguageModelV3 {
  let callCount = 0;

  const getStep = (): ToolLoopStep => {
    const step = steps[callCount] ?? steps.at(-1);
    if (!step) {
      return { kind: "text", text: "" };
    }
    return step;
  };

  return new MockLanguageModelV3({
    doStream: async () => {
      const lastText = [...steps].reverse().find((s) => s.kind === "text");
      const text = lastText?.kind === "text" ? lastText.text : "";
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start" as const, id: "text-1" },
            { type: "text-delta" as const, id: "text-1", delta: text },
            { type: "text-end" as const, id: "text-1" },
            {
              type: "finish" as const,
              finishReason: { unified: "stop" as const, raw: undefined },
              logprobs: undefined,
              usage: usage(),
            },
          ],
        }),
      };
    },
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

function stubMcpManager() {
  return {
    listToolDescriptors: vi.fn(async () => []),
    shutdown: vi.fn(async () => {}),
    callTool: vi.fn(async () => ({ content: [] })),
  };
}

describe("AgentRuntime approval/permission scenarios (e2e)", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  const restoreEnv = (key: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  };

  const originalEnv = {
    TYRUM_POLICY_ENABLED: process.env["TYRUM_POLICY_ENABLED"],
    TYRUM_POLICY_MODE: process.env["TYRUM_POLICY_MODE"],
    TYRUM_POLICY_BUNDLE_PATH: process.env["TYRUM_POLICY_BUNDLE_PATH"],
    TYRUM_HOME: process.env["TYRUM_HOME"],
  };

  beforeEach(() => {
    process.env["TYRUM_POLICY_ENABLED"] = "1";
    process.env["TYRUM_POLICY_MODE"] = "enforce";
    delete process.env["TYRUM_POLICY_BUNDLE_PATH"];
    delete process.env["TYRUM_HOME"];
  });

  afterEach(async () => {
    restoreEnv("TYRUM_POLICY_ENABLED", originalEnv.TYRUM_POLICY_ENABLED);
    restoreEnv("TYRUM_POLICY_MODE", originalEnv.TYRUM_POLICY_MODE);
    restoreEnv("TYRUM_POLICY_BUNDLE_PATH", originalEnv.TYRUM_POLICY_BUNDLE_PATH);
    restoreEnv("TYRUM_HOME", originalEnv.TYRUM_HOME);

    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("expires tool approvals when no response arrives (tool not executed)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-perms-agent-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

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

    const languageModel = createSequencedToolLoopLanguageModel([
      {
        kind: "tool-calls",
        toolCalls: [
          {
            id: "tc-expire",
            name: "tool.exec",
            arguments: JSON.stringify({ command: "echo hi" }),
          },
        ],
      },
      { kind: "text", text: "done" },
    ]);

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      agentId: "agent-test",
      workspaceId: "ws-test",
      languageModel,
      mcpManager: stubMcpManager() as unknown as ConstructorParameters<typeof AgentRuntime>[0]["mcpManager"],
      approvalWaitMs: 1_000,
      approvalPollMs: 100,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-approval-expire-1",
      message: "run a command",
    });

    const pending = await waitForPendingApproval(container);
    expect(pending.prompt).toContain("tool.exec");
    expect(pending.status).toBe("pending");

    const result = await turnPromise;
    expect(result.reply).toBe("done");
    expect(result.used_tools).not.toContain("tool.exec");

    const resolved = await container.approvalDal.getById(pending.id);
    expect(resolved?.status).toBe("expired");
  }, 10_000);

  it("short-circuits policy denies without creating approvals (tool not executed)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-perms-agent-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

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

    await writeFile(
      join(homeDir, "policy.yml"),
      [
        "v: 1",
        "tools:",
        "  default: allow",
        "  allow: []",
        "  require_approval: []",
        "  deny:",
        "    - tool.fs.write",
        "",
      ].join("\n"),
      "utf-8",
    );

    const languageModel = createSequencedToolLoopLanguageModel([
      {
        kind: "tool-calls",
        toolCalls: [
          {
            id: "tc-denied",
            name: "tool.fs.write",
            arguments: JSON.stringify({ path: "blocked.txt", content: "secret" }),
          },
        ],
      },
      { kind: "text", text: "done" },
    ]);

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: stubMcpManager() as unknown as ConstructorParameters<typeof AgentRuntime>[0]["mcpManager"],
      approvalWaitMs: 5_000,
      approvalPollMs: 20,
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-policy-deny-1",
      message: "write a file",
    });

    expect(result.reply).toBe("done");
    expect(result.used_tools).not.toContain("tool.fs.write");

    const pending = await container.approvalDal.getPending();
    expect(pending).toHaveLength(0);
    await expect(access(join(homeDir, "blocked.txt"))).rejects.toThrow();
  });

  it("executes mixed tool-call batches and only blocks on the approval-required tool", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-perms-agent-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

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
        "    - tool.exec",
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    const languageModel = createSequencedToolLoopLanguageModel([
      {
        kind: "tool-calls",
        toolCalls: [
          { id: "tc-read", name: "tool.fs.read", arguments: JSON.stringify({ path: "a.txt" }) },
          { id: "tc-exec", name: "tool.exec", arguments: JSON.stringify({ command: "echo hi" }) },
        ],
      },
      { kind: "text", text: "done" },
    ]);

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: stubMcpManager() as unknown as ConstructorParameters<typeof AgentRuntime>[0]["mcpManager"],
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-mixed-1",
      message: "read a file then run a command",
    });

    const pending = await waitForPendingApproval(container);
    expect(pending.prompt).toContain("tool.exec");
    await container.approvalDal.respond(pending.id, true, "approved in test");

    const result = await turnPromise;
    expect(result.reply).toBe("done");
    expect(result.used_tools).toContain("tool.fs.read");
    expect(result.used_tools).toContain("tool.exec");
  });

  it("does not resolve secrets until tool execution is approved", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-perms-agent-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

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
        "sessions:",
        "  ttl_days: 30",
        "  max_turns: 20",
        "memory:",
        "  markdown_enabled: false",
      ].join("\n"),
      "utf-8",
    );

    await writeFile(
      join(homeDir, "policy.yml"),
      [
        "v: 1",
        "tools:",
        "  default: deny",
        "  allow:",
        "    - tool.http.fetch",
        "  require_approval: []",
        "  deny: []",
        "network_egress:",
        "  default: deny",
        "  allow:",
        `    - "${fetchUrl}/*"`,
        "  require_approval: []",
        "  deny: []",
        "secrets:",
        "  default: allow",
        "  allow: []",
        "  require_approval:",
        "    - \"env:billing\"",
        "  deny: []",
        "",
      ].join("\n"),
      "utf-8",
    );

    const handles: SecretHandle[] = [
      {
        handle_id: "handle-abc",
        provider: "env",
        scope: "billing",
        created_at: new Date().toISOString(),
      },
    ];
    const secretProvider: SecretProvider = {
      resolve: vi.fn(async (handle: SecretHandle) => {
        if (handle.handle_id !== "handle-abc") return null;
        return "SECRET_VALUE";
      }),
      store: vi.fn(async () => ({ handle_id: "h1", provider: "env", scope: "billing", created_at: "" })),
      revoke: vi.fn(async () => true),
      list: vi.fn(async () => handles),
    };

    const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const resolved = typeof url === "string" ? url : url.toString();
      if (resolved !== fetchUrl) {
        return new Response("not found", { status: 404 });
      }
      expect(init?.headers).toMatchObject({ Authorization: "SECRET_VALUE" });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const languageModel = createSequencedToolLoopLanguageModel([
      {
        kind: "tool-calls",
        toolCalls: [
          {
            id: "tc-fetch",
            name: "tool.http.fetch",
            arguments: JSON.stringify({
              url: fetchUrl,
              headers: { Authorization: "secret:handle-abc" },
            }),
          },
        ],
      },
      { kind: "text", text: "done" },
    ]);

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      fetchImpl: fetchStub,
      secretProvider,
      mcpManager: stubMcpManager() as unknown as ConstructorParameters<typeof AgentRuntime>[0]["mcpManager"],
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-secrets-1",
      message: "fetch a url using a secret header",
    });

    const pending = await waitForPendingApproval(container);
    expect(secretProvider.list).toHaveBeenCalled();
    expect(secretProvider.resolve).not.toHaveBeenCalled();

    await container.approvalDal.respond(pending.id, true, "approved in test");

    const result = await turnPromise;
    expect(result.reply).toBe("done");
    expect(secretProvider.resolve).toHaveBeenCalled();
    expect(fetchStub).toHaveBeenCalled();
    expect(result.used_tools).toContain("tool.http.fetch");
  });
});
