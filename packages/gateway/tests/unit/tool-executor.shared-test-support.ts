import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, vi } from "vitest";
import type { McpManager } from "../../src/modules/agent/mcp-manager.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import { ToolExecutor } from "../../src/modules/agent/tool-executor.js";

export type HomeDirState = {
  current: string | undefined;
};

type ToolExecutorCtor = ConstructorParameters<typeof ToolExecutor>;

type ToolExecutorFactoryOptions = {
  homeDir: string;
  mcpManager?: ToolExecutorCtor[1];
  mcpServerSpecs?: ToolExecutorCtor[2];
  fetchImpl?: ToolExecutorCtor[3];
  secretProvider?: SecretProvider;
  dnsLookup?: ToolExecutorCtor[5];
  workspaceLease?: ToolExecutorCtor[8];
  nodeDispatchService?: ToolExecutorCtor[9];
  identityScopeDal?: ToolExecutorCtor[11];
};

export function registerTempHomeLifecycle(prefix = "tool-executor-"): HomeDirState {
  const state: HomeDirState = { current: undefined };

  beforeEach(async () => {
    state.current = await mkdtemp(join(tmpdir(), prefix));
  });

  afterEach(async () => {
    if (!state.current) return;
    await rm(state.current, { recursive: true, force: true });
    state.current = undefined;
  });

  return state;
}

export function requireHomeDir(state: HomeDirState): string {
  if (!state.current) {
    throw new Error("test home directory not initialized");
  }

  return state.current;
}

export function stubMcpManager(overrides?: Partial<McpManager>): McpManager {
  return {
    listToolDescriptors: vi.fn(async () => []),
    shutdown: vi.fn(async () => {}),
    callTool: vi.fn(async () => ({ content: [{ type: "text", text: "mcp-result" }] })),
    ...overrides,
  } as unknown as McpManager;
}

export function createTextFetchMock(body: string): ToolExecutorCtor[3] {
  return vi.fn(async () => ({
    text: async () => body,
  })) as unknown as ToolExecutorCtor[3];
}

export function createToolExecutor({
  homeDir,
  mcpManager = stubMcpManager(),
  mcpServerSpecs = new Map(),
  fetchImpl = fetch,
  secretProvider,
  dnsLookup,
  workspaceLease,
  nodeDispatchService,
  identityScopeDal,
}: ToolExecutorFactoryOptions): ToolExecutor {
  return new ToolExecutor(
    homeDir,
    mcpManager,
    mcpServerSpecs,
    fetchImpl,
    secretProvider,
    dnsLookup,
    undefined,
    undefined,
    workspaceLease,
    nodeDispatchService,
    undefined,
    identityScopeDal,
  );
}
