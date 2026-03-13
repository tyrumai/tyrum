import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { ToolSetBuilder } from "../../src/modules/agent/runtime/tool-set-builder.js";
import { AgentConfig } from "@tyrum/schemas";
import { AgentConfigDal } from "../../src/modules/config/agent-config-dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const migrationsDir = join(__dirname, "../../migrations/sqlite");

export { DEFAULT_AGENT_ID, DEFAULT_TENANT_ID, DEFAULT_WORKSPACE_ID };

export const fetch404 = (async () => new Response("not found", { status: 404 })) as typeof fetch;

export function makeContextReport(
  overrides?: Partial<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    context_report_id: "123e4567-e89b-12d3-a456-426614174000",
    generated_at: "2026-02-23T00:00:00.000Z",
    session_id: "session-1",
    channel: "test",
    thread_id: "thread-1",
    agent_id: DEFAULT_AGENT_ID,
    workspace_id: DEFAULT_WORKSPACE_ID,
    system_prompt: { chars: 0, sections: [] },
    user_parts: [],
    selected_tools: [],
    tool_schema_top: [],
    tool_schema_total_chars: 0,
    enabled_skills: [],
    mcp_servers: [],
    memory: { keyword_hits: 0, semantic_hits: 0 },
    tool_calls: [],
    injected_files: [],
    ...overrides,
  };
}

export function createToolSetBuilder(input: {
  home: string;
  container: GatewayContainer;
  policyService: unknown;
  secretProvider?: unknown;
  plugins?: unknown;
}): ToolSetBuilder {
  return new ToolSetBuilder({
    home: input.home,
    tenantId: DEFAULT_TENANT_ID,
    agentId: DEFAULT_AGENT_ID,
    workspaceId: DEFAULT_WORKSPACE_ID,
    policyService: input.policyService as unknown as ConstructorParameters<
      typeof ToolSetBuilder
    >[0]["policyService"],
    approvalDal: input.container.approvalDal,
    approvalWaitMs: 120_000,
    approvalPollMs: 500,
    logger: input.container.logger,
    secretProvider: input.secretProvider as unknown as ConstructorParameters<
      typeof ToolSetBuilder
    >[0]["secretProvider"],
    plugins: input.plugins as unknown as ConstructorParameters<typeof ToolSetBuilder>[0]["plugins"],
    redactionEngine: input.container.redactionEngine,
  });
}

export function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export async function seedAgentConfig(
  container: GatewayContainer,
  input: {
    tenantKey?: string;
    agentKey?: string;
    workspaceKey?: string;
    config: unknown;
  },
): Promise<void> {
  const tenantKey = input.tenantKey?.trim() || "default";
  const agentKey = input.agentKey?.trim() || "default";
  const workspaceKey = input.workspaceKey?.trim() || "default";
  const scopeIds = await container.identityScopeDal.resolveScopeIds({
    tenantKey,
    agentKey,
    workspaceKey,
  });
  await new AgentConfigDal(container.db).set({
    tenantId: scopeIds.tenantId,
    agentId: scopeIds.agentId,
    config: AgentConfig.parse(input.config),
    createdBy: { kind: "test" },
    reason: "test",
  });
}

export async function setupTestEnv(): Promise<{
  homeDir: string;
  container: GatewayContainer;
}> {
  const homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
  const container = await createContainer({
    dbPath: ":memory:",
    migrationsDir,
    tyrumHome: homeDir,
  });
  return { homeDir, container };
}

export async function setupFileBackedTestEnv(): Promise<{
  homeDir: string;
  dbPath: string;
  container: GatewayContainer;
}> {
  const homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
  const dbPath = join(homeDir, "gateway.sqlite");
  const container = await createContainer({
    dbPath,
    migrationsDir,
    tyrumHome: homeDir,
  });
  return { homeDir, dbPath, container };
}

export async function restartFileBackedContainer(input: {
  homeDir: string;
  dbPath: string;
  container?: GatewayContainer;
}): Promise<GatewayContainer> {
  await input.container?.db.close();
  return await createContainer({
    dbPath: input.dbPath,
    migrationsDir,
    tyrumHome: input.homeDir,
  });
}

export async function teardownTestEnv(env: {
  homeDir?: string;
  container?: GatewayContainer;
}): Promise<void> {
  await env.container?.db.close();
  if (env.homeDir) {
    await rm(env.homeDir, { recursive: true, force: true });
  }
}
