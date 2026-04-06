import { afterEach, describe, expect, it, vi } from "vitest";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import type { ApprovalRow } from "../../src/modules/approval/dal.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import { AgentConfig, type SecretHandle } from "@tyrum/contracts";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { AgentConfigDal } from "../../src/modules/config/agent-config-dal.js";
import { seedDeploymentPolicyBundle } from "../helpers/runtime-config.js";

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
      const lastText = steps.toReversed().find((s) => s.kind === "text");
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
    const pending = await container.approvalDal.getPending({ tenantId: DEFAULT_TENANT_ID });
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

async function seedAgentConfig(
  container: GatewayContainer,
  params: {
    agentKey?: string;
    workspaceKey?: string;
    toolsAllow: string[];
  },
): Promise<void> {
  const ids = await container.identityScopeDal.resolveScopeIds({
    agentKey: params.agentKey,
    workspaceKey: params.workspaceKey,
  });
  await new AgentConfigDal(container.db).set({
    tenantId: ids.tenantId,
    agentId: ids.agentId,
    config: AgentConfig.parse({
      model: { model: "openai/gpt-4.1" },
      skills: { enabled: [] },
      mcp: {
        enabled: [],
        server_settings: { memory: { enabled: false } },
      },
      tools: { allow: params.toolsAllow },
      conversations: { ttl_days: 30, max_turns: 20 },
    }),
    createdBy: { kind: "test" },
    reason: "permission scenarios test seed",
  });
}

describe("AgentRuntime approval/permission scenarios (e2e)", () => {
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

  it("expires tool approvals when no response arrives (tool not executed)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-perms-agent-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    await seedAgentConfig(container, {
      agentKey: "agent-test",
      workspaceKey: "ws-test",
      toolsAllow: ["bash"],
    });

    const languageModel = createSequencedToolLoopLanguageModel([
      {
        kind: "tool-calls",
        toolCalls: [
          {
            id: "tc-expire",
            name: "bash",
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
      mcpManager: stubMcpManager() as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
      approvalWaitMs: 1_000,
      approvalPollMs: 100,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-approval-expire-1",
      message: "run a command",
    });

    const pending = await waitForPendingApproval(container);
    expect(pending.prompt).toContain("bash");
    expect(pending.status).toBe("queued");

    let resumed = false;
    const expiryTimer = setInterval(() => {
      void (async () => {
        const c = container;
        if (!c) return;
        await c.approvalDal.expireStale({ tenantId: DEFAULT_TENANT_ID });
        const current = await c.approvalDal.getById({
          tenantId: DEFAULT_TENANT_ID,
          approvalId: pending.approval_id,
        });
        if (!current || resumed) return;
        if (current.status !== "expired") return;
        if (current.resume_token) {
          resumed = true;
          await runtime.turnController.resumeTurn(current.resume_token);
        }
      })().catch(() => {
        // ignore (tests may tear down while the timer is running)
      });
    }, 50);
    expiryTimer.unref();

    let result: Awaited<ReturnType<AgentRuntime["turn"]>>;
    try {
      result = await turnPromise;
    } finally {
      clearInterval(expiryTimer);
    }
    expect(result.reply).toBe("done");
    expect(result.used_tools).not.toContain("bash");

    const resolved = await container.approvalDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: pending.approval_id,
    });
    expect(resolved?.status).toBe("expired");
  }, 10_000);

  it("does not get stuck when a denied tool approval is missing a resume token", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-perms-agent-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    await seedAgentConfig(container, {
      agentKey: "agent-test",
      workspaceKey: "ws-test",
      toolsAllow: ["bash"],
    });

    const languageModel = createSequencedToolLoopLanguageModel([
      {
        kind: "tool-calls",
        toolCalls: [
          {
            id: "tc-deny-missing-token",
            name: "bash",
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
      mcpManager: stubMcpManager() as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
      approvalWaitMs: 10_000,
      approvalPollMs: 50,
      turnEngineWaitMs: 800,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-approval-deny-missing-token-1",
      message: "run a command",
    });

    const pending = await waitForPendingApproval(container);
    expect(pending.prompt).toContain("bash");
    expect(pending.status).toBe("queued");

    await container.approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: pending.approval_id,
      decision: "denied",
      reason: "denied in test",
    });
    await container.db.run(
      "UPDATE approvals SET resume_token = NULL WHERE tenant_id = ? AND approval_id = ?",
      [DEFAULT_TENANT_ID, pending.approval_id],
    );

    let err: unknown;
    try {
      await turnPromise;
      throw new Error("expected turn to throw");
    } catch (caught) {
      err = caught;
    }

    const message = err instanceof Error ? err.message : String(err);
    expect(message).not.toContain("did not complete within");
  }, 10_000);

  it("short-circuits policy denies without creating approvals (tool not executed)", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-perms-agent-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    await seedAgentConfig(container, { toolsAllow: ["write"] });

    await seedDeploymentPolicyBundle(container.db, {
      v: 1,
      tools: {
        default: "allow",
        allow: [],
        require_approval: [],
        deny: ["write"],
      },
    });

    const languageModel = createSequencedToolLoopLanguageModel([
      {
        kind: "tool-calls",
        toolCalls: [
          {
            id: "tc-denied",
            name: "write",
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
      mcpManager: stubMcpManager() as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
      approvalWaitMs: 5_000,
      approvalPollMs: 20,
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-policy-deny-1",
      message: "write a file",
    });

    expect(result.reply).toBe("done");
    expect(result.used_tools).not.toContain("write");

    const pending = await container.approvalDal.getPending({ tenantId: DEFAULT_TENANT_ID });
    expect(pending).toHaveLength(0);
    await expect(access(join(homeDir, "blocked.txt"))).rejects.toThrow();
  });

  it("executes mixed tool-call batches and only blocks on the approval-required tool", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-perms-agent-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    await writeFile(join(homeDir, "a.txt"), "file A", "utf-8");
    await seedAgentConfig(container, { toolsAllow: ["read", "bash"] });

    const languageModel = createSequencedToolLoopLanguageModel([
      {
        kind: "tool-calls",
        toolCalls: [
          { id: "tc-read", name: "read", arguments: JSON.stringify({ path: "a.txt" }) },
          { id: "tc-exec", name: "bash", arguments: JSON.stringify({ command: "echo hi" }) },
        ],
      },
      { kind: "text", text: "done" },
    ]);

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      mcpManager: stubMcpManager() as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-mixed-1",
      message: "read a file then run a command",
    });

    const pending = await waitForPendingApproval(container);
    expect(pending.prompt).toContain("bash");
    const updated = await container.approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: pending.approval_id,
      decision: "approved",
      reason: "approved in test",
    });
    if (updated?.resume_token) {
      await runtime.turnController.resumeTurn(updated.resume_token);
    }

    const result = await turnPromise;
    expect(result.reply).toBe("done");
    expect(result.used_tools).toContain("read");
    expect(result.used_tools).toContain("bash");
  });

  it("does not resolve the Exa API key until tool execution is approved", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-perms-agent-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const fetchUrl = "https://example.com";
    await seedAgentConfig(container, { toolsAllow: ["webfetch"] });

    await seedDeploymentPolicyBundle(container.db, {
      v: 1,
      tools: {
        default: "allow",
        allow: [],
        require_approval: ["webfetch"],
        deny: [],
      },
      network_egress: {
        default: "deny",
        allow: [`${fetchUrl}/*`],
        require_approval: [],
        deny: [],
      },
    });

    const secretProvider: SecretProvider = {
      resolve: vi.fn(async (handle: SecretHandle) => {
        if (handle.handle_id !== "exa_api_key") return null;
        return "exa-key";
      }),
      store: vi.fn(async () => ({
        handle_id: "h1",
        provider: "db",
        scope: "billing",
        created_at: "",
      })),
      revoke: vi.fn(async () => true),
      list: vi.fn(async () => []),
    };

    const mcpManager = stubMcpManager();
    mcpManager.callTool.mockImplementation(
      async (spec: { url?: string }, toolName: string, args: Record<string, unknown>) => {
        expect(spec.url).toContain("exaApiKey=exa-key");
        expect(toolName).toBe("crawling_exa");
        expect(args).toEqual({ url: fetchUrl });
        return { content: [{ type: "text", text: "ok" }], isError: false };
      },
    );

    const languageModel = createSequencedToolLoopLanguageModel([
      {
        kind: "tool-calls",
        toolCalls: [
          {
            id: "tc-fetch",
            name: "webfetch",
            arguments: JSON.stringify({ url: fetchUrl }),
          },
        ],
      },
      { kind: "text", text: "done" },
    ]);

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel,
      secretProvider,
      mcpManager: mcpManager as unknown as ConstructorParameters<
        typeof AgentRuntime
      >[0]["mcpManager"],
      approvalWaitMs: 10_000,
      approvalPollMs: 20,
    });

    const turnPromise = runtime.turn({
      channel: "test",
      thread_id: "thread-secrets-1",
      message: "fetch a url using a secret header",
    });

    const pending = await waitForPendingApproval(container);
    expect(pending.prompt).toContain("webfetch");
    expect(secretProvider.list).not.toHaveBeenCalled();
    expect(secretProvider.resolve).not.toHaveBeenCalled();
    expect(mcpManager.callTool).not.toHaveBeenCalled();

    const updated = await container.approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: pending.approval_id,
      decision: "approved",
      reason: "approved in test",
    });
    if (updated?.resume_token) {
      await runtime.turnController.resumeTurn(updated.resume_token);
    }

    const result = await turnPromise;
    expect(result.reply).toBe("done");
    expect(secretProvider.resolve).toHaveBeenCalled();
    expect(mcpManager.callTool).toHaveBeenCalled();
    expect(result.used_tools).toContain("webfetch");
  });
});
