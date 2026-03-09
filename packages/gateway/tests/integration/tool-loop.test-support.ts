import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { Hono } from "hono";
import { expect, vi } from "vitest";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import type { ApprovalRow } from "../../src/modules/approval/dal.js";
import { AgentConfigDal } from "../../src/modules/config/agent-config-dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { createApprovalRoutes } from "../../src/routes/approval.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

export type ToolCallFixture = { id: string; name: string; arguments: string };

export type ToolLoopStep =
  | { kind: "tool-calls"; toolCalls: ToolCallFixture[] }
  | { kind: "text"; text: string };

export type ToolLoopTestState = {
  homeDir?: string;
  container?: GatewayContainer;
};

type AgentRuntimeOptions = ConstructorParameters<typeof AgentRuntime>[0];

type SeedAgentConfigParams = {
  agentKey?: string;
  workspaceKey?: string;
  config: {
    model?: { model?: string };
    skills?: { enabled?: string[] };
    mcp?: { enabled?: string[] };
    tools: { allow: string[] };
    sessions?: {
      ttl_days?: number;
      max_turns?: number;
      loop_detection?: {
        within_turn?: { enabled?: boolean };
        cross_turn?: { enabled?: boolean };
      };
      context_pruning?: { max_messages?: number; tool_prune_keep_last_messages?: number };
    };
    memory?: { v1?: { enabled?: boolean } };
  };
};

export const defaultApprovalScope = {
  tenantId: DEFAULT_TENANT_ID,
  agentId: DEFAULT_AGENT_ID,
  workspaceId: DEFAULT_WORKSPACE_ID,
} as const;

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

export function createToolLoopTestState(): ToolLoopTestState {
  return {};
}

export async function cleanupToolLoopTestState(state: ToolLoopTestState): Promise<void> {
  await state.container?.db.close();
  state.container = undefined;

  if (state.homeDir) {
    await rm(state.homeDir, { recursive: true, force: true });
    state.homeDir = undefined;
  }
}

export async function setupToolLoopTest(
  state: ToolLoopTestState,
  input: {
    seedConfig?: SeedAgentConfigParams;
    containerOptions?: Parameters<typeof createContainer>[1];
  } = {},
): Promise<{ homeDir: string; container: GatewayContainer }> {
  state.homeDir = await mkdtemp(join(tmpdir(), "tyrum-tool-loop-"));
  const container = await resetToolLoopContainer(state, input);
  return { homeDir: state.homeDir, container };
}

export async function resetToolLoopContainer(
  state: ToolLoopTestState,
  input: {
    seedConfig?: SeedAgentConfigParams;
    containerOptions?: Parameters<typeof createContainer>[1];
  } = {},
): Promise<GatewayContainer> {
  await state.container?.db.close();
  state.container = await createContainer(
    { dbPath: ":memory:", migrationsDir },
    input.containerOptions,
  );

  if (input.seedConfig) {
    await seedAgentConfig(state.container, input.seedConfig);
  }

  return state.container;
}

export function createMockMcpManager(): AgentRuntimeOptions["mcpManager"] {
  return {
    listToolDescriptors: vi.fn(async () => []),
    shutdown: vi.fn(async () => {}),
    callTool: vi.fn(async () => ({ content: [] })),
  } as AgentRuntimeOptions["mcpManager"];
}

export function createTestRuntime(
  input: Omit<AgentRuntimeOptions, "mcpManager"> & {
    mcpManager?: AgentRuntimeOptions["mcpManager"];
  },
): AgentRuntime {
  return new AgentRuntime({
    ...input,
    mcpManager: input.mcpManager ?? createMockMcpManager(),
  });
}

export function createToolLoopLanguageModel(input: {
  toolCalls: ToolCallFixture[];
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
          content: input.toolCalls.map((toolCall) => ({
            type: "tool-call" as const,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            input: toolCall.arguments,
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

export function createSequencedToolLoopLanguageModel(
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
          content: step.toolCalls.map((toolCall) => ({
            type: "tool-call" as const,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            input: toolCall.arguments,
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

export async function waitForPendingApproval(
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

export async function seedAgentConfig(
  container: GatewayContainer,
  params: SeedAgentConfigParams,
): Promise<{ tenantId: string; agentId: string; workspaceId: string }> {
  const ids = await container.identityScopeDal.resolveScopeIds({
    agentKey: params.agentKey,
    workspaceKey: params.workspaceKey,
  });
  const dal = new AgentConfigDal(container.db);
  await dal.set({
    tenantId: ids.tenantId,
    agentId: ids.agentId,
    config: {
      model: { model: "openai/gpt-4.1", ...params.config.model },
      skills: { enabled: [], ...params.config.skills },
      mcp: { enabled: [], ...params.config.mcp },
      tools: params.config.tools,
      sessions: {
        ttl_days: 30,
        max_turns: 20,
        ...params.config.sessions,
        loop_detection: {
          within_turn: { enabled: true, ...params.config.sessions?.loop_detection?.within_turn },
          cross_turn: { enabled: true, ...params.config.sessions?.loop_detection?.cross_turn },
        },
      },
      memory: { v1: { enabled: false }, ...params.config.memory },
    },
    createdBy: { kind: "test" },
    reason: "test seed",
  });
  return ids;
}

export async function respondToApproval(
  container: GatewayContainer,
  approvalId: number,
  body: Record<string, unknown>,
  input: { includePolicyOverrideDal?: boolean; tenantId?: string } = {},
): Promise<Response> {
  const approvalApp = new Hono();
  stubTenantAuth(approvalApp, input.tenantId);
  approvalApp.route(
    "/",
    createApprovalRoutes({
      approvalDal: container.approvalDal,
      policyOverrideDal: input.includePolicyOverrideDal ? container.policyOverrideDal : undefined,
      engine: new ExecutionEngine({ db: container.db }),
    }),
  );

  return approvalApp.request(`/approvals/${String(approvalId)}/respond`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function writeFixtureFiles(
  homeDir: string,
  files: Record<string, string>,
): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([name, content]) => {
      await writeFile(join(homeDir, name), content, "utf-8");
    }),
  );
}

export function createFetchStub(
  files: Record<string, { body: string; status?: number }>,
): typeof fetch {
  return vi.fn(async (url: string | URL | Request) => {
    const resolved = typeof url === "string" ? url : url.toString();
    const response = files[resolved];
    if (!response) {
      return new Response("not found", { status: 404 });
    }
    return new Response(response.body, { status: response.status ?? 200 });
  }) as typeof fetch;
}

export function readToolCall(id: string, path: string): ToolCallFixture {
  return { id, name: "read", arguments: JSON.stringify({ path }) };
}

export function fetchToolCall(id: string, url: string): ToolCallFixture {
  return { id, name: "webfetch", arguments: JSON.stringify({ url }) };
}

export function execToolCall(id: string, command: string): ToolCallFixture {
  return { id, name: "bash", arguments: JSON.stringify({ command }) };
}

export function writeToolCall(id: string, path: string, content: string): ToolCallFixture {
  return { id, name: "write", arguments: JSON.stringify({ path, content }) };
}

export function toolCallsStep(...toolCalls: ToolCallFixture[]): ToolLoopStep {
  return { kind: "tool-calls", toolCalls };
}

export function textStep(text: string): ToolLoopStep {
  return { kind: "text", text };
}

export function collectPromptToolIds(prompt: unknown[]): {
  toolCallIds: Set<string>;
  toolResultIds: Set<string>;
} {
  const toolCallIds = new Set<string>();
  const toolResultIds = new Set<string>();

  for (const message of prompt) {
    if (!message || typeof message !== "object") continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (!part || typeof part !== "object") continue;

      const type = (part as { type?: unknown }).type;
      const toolCallId = (part as { toolCallId?: unknown }).toolCallId;
      if (type === "tool-call" && typeof toolCallId === "string") {
        toolCallIds.add(toolCallId);
      }
      if (type === "tool-result" && typeof toolCallId === "string") {
        toolResultIds.add(toolCallId);
      }
    }
  }

  return { toolCallIds, toolResultIds };
}

export function findLastNonTitleGenerateCall(
  languageModel: MockLanguageModelV3,
): { prompt: unknown[] } | undefined {
  for (let index = languageModel.doGenerateCalls.length - 1; index >= 0; index -= 1) {
    const call = languageModel.doGenerateCalls[index];
    if (!call) continue;
    const promptText = JSON.stringify(call.prompt);
    if (promptText.includes("Write a concise session title.")) continue;
    return call as { prompt: unknown[] };
  }
  return undefined;
}

export function findSuggestedOverride(pending: ApprovalRow): {
  tool_id: string;
  pattern: string;
  workspace_id?: string;
} {
  const suggested = (pending.context as { policy?: { suggested_overrides?: unknown[] } }).policy
    ?.suggested_overrides;
  expect(Array.isArray(suggested)).toBe(true);

  const selectedOverride = (suggested ?? []).find(
    (entry): entry is { tool_id: string; pattern: string; workspace_id?: string } =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { tool_id?: unknown }).tool_id === "string" &&
      typeof (entry as { pattern?: unknown }).pattern === "string",
  );
  expect(selectedOverride).toBeTruthy();
  return selectedOverride!;
}

function stubTenantAuth(app: Hono, tenantId = DEFAULT_TENANT_ID): void {
  app.use("*", async (c, next) => {
    c.set("authClaims", {
      token_kind: "admin",
      token_id: "test-token",
      tenant_id: tenantId,
      role: "admin",
      scopes: ["*"],
    });
    await next();
  });
}
