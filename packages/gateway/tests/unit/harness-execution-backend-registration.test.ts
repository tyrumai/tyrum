import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { createDefaultAgentContextStore } from "../../src/modules/agent/context-store.js";
import { ConversationExecutionBackendOverrideDal } from "../../src/modules/agent/execution-backend-override-dal.js";
import {
  NativeExecutionBackend,
  resolveExecutionBackendForConversation,
  type ExecutionBackend,
  type HarnessExecutionBackends,
} from "../../src/modules/agent/execution-backend.js";
import { AgentRuntime } from "../../src/modules/agent/runtime/agent-runtime.js";
import { loadClaudeQuery } from "../../src/modules/harness/claude-agent-sdk/client.js";
import { createHarnessExecutionBackends } from "../../src/modules/harness/execution-backends.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

/**
 * Detects an actual `@anthropic-ai/claude-agent-sdk` module load.
 *
 * The last test in this file is a positive control: if this interception ever
 * stops working the control goes red, so a `loads === 0` assertion can never be
 * a silent false green.
 */
const sdkProbe = vi.hoisted(() => ({ loads: 0 }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => {
  sdkProbe.loads += 1;
  return {
    query: () => ({
      async *[Symbol.asyncIterator]() {
        yield await Promise.reject(new Error("stub SDK query must not be iterated in this suite"));
      },
    }),
  };
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function countingRegistry(inner: HarnessExecutionBackends): {
  registry: HarnessExecutionBackends;
  state: { reads: number };
} {
  const state = { reads: 0 };
  const registry: HarnessExecutionBackends = {
    get claude_agent_sdk(): ExecutionBackend | undefined {
      state.reads += 1;
      return inner.claude_agent_sdk;
    },
  };
  return { registry, state };
}

describe("harness execution backend registration", () => {
  let container: GatewayContainer | undefined;
  let runtime: AgentRuntime | undefined;
  let homeDir: string | undefined;

  afterEach(async () => {
    await runtime?.shutdown();
    runtime = undefined;
    await container?.db.close();
    container = undefined;
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  async function createFixture() {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-harness-registration-"));
    const home = homeDir;
    container = createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: home });
    const built = container;

    const conversation = await built.conversationDal.getOrCreate({
      tenantId: DEFAULT_TENANT_ID,
      scopeKeys: { agentKey: "default", workspaceKey: "default" },
      connectorKey: "ui",
      providerThreadId: randomUUID(),
      containerKind: "channel",
    });

    const real = createHarnessExecutionBackends({
      db: built.db,
      conversationDal: built.conversationDal,
      contextStore: createDefaultAgentContextStore({ home, container: built }),
      memoryDal: built.memoryDal,
      policyService: built.policyService,
      approvalDal: built.approvalDal,
      tenantId: conversation.tenant_id,
      agentKey: "default",
      workspaceKey: "default",
      workspaceRoot: home,
      approvalWaitMs: 1_000,
      approvalPollMs: 100,
      logger: built.logger,
      deploymentConfig: built.deploymentConfig,
    });
    const counted = countingRegistry(real);

    // The seam production uses: the runtime carries the registry to all three
    // `resolveExecutionBackendForConversation` call sites.
    runtime = new AgentRuntime({
      container: built,
      tenantId: conversation.tenant_id,
      home,
      agentId: "default",
      harnessBackends: counted.registry,
    });

    const executeTurn = vi.fn(async () => ({
      reply: "native",
      conversation_id: conversation.conversation_id,
      conversation_key: conversation.conversation_key,
      attachments: [],
      used_tools: [],
      memory_written: false,
    }));

    return {
      conversation,
      container: built,
      counted,
      executeTurn,
      nativeBackend: new NativeExecutionBackend({ executeTurn }),
      runtime,
    };
  }

  it("leaves the native path untouched and builds nothing when no override row exists", async () => {
    const fixture = await createFixture();

    // Constructing the runtime must not read the registry.
    expect(fixture.runtime.harnessBackends).toBe(fixture.counted.registry);
    expect(fixture.counted.state.reads).toBe(0);

    const backend = await resolveExecutionBackendForConversation({
      db: fixture.container.db,
      tenantId: fixture.conversation.tenant_id,
      conversationKey: fixture.conversation.conversation_key,
      nativeBackend: fixture.nativeBackend,
      harnessBackends: fixture.runtime.harnessBackends,
    });

    expect(backend).toBe(fixture.nativeBackend);
    const response = await backend.executeTurn({ channel: "ui", thread_id: "t-1" });
    expect(response.reply).toBe("native");
    expect(fixture.executeTurn).toHaveBeenCalledTimes(1);
    // No harness backend was constructed, so nothing could have loaded the SDK.
    expect(fixture.counted.state.reads).toBe(0);
    expect(sdkProbe.loads).toBe(0);
  });

  it("routes to the registered claude_agent_sdk backend once an override row exists", async () => {
    const fixture = await createFixture();
    await new ConversationExecutionBackendOverrideDal(fixture.container.db).set({
      tenantId: fixture.conversation.tenant_id,
      conversationId: fixture.conversation.conversation_id,
      backendId: "claude_agent_sdk",
    });

    const resolve = async (): Promise<ExecutionBackend> =>
      await resolveExecutionBackendForConversation({
        db: fixture.container.db,
        tenantId: fixture.conversation.tenant_id,
        conversationKey: fixture.conversation.conversation_key,
        nativeBackend: fixture.nativeBackend,
        harnessBackends: fixture.runtime.harnessBackends,
      });

    const first = await resolve();
    const second = await resolve();

    expect(first.id).toBe("claude_agent_sdk");
    // Memoized: the registry was read twice but the backend was assembled once.
    expect(first).toBe(second);
    expect(fixture.counted.state.reads).toBe(2);
    expect(fixture.executeTurn).not.toHaveBeenCalled();
    // Assembling the backend still must not pull the vendor SDK in.
    expect(sdkProbe.loads).toBe(0);
  });

  it("gives every runtime a lazily-assembled default registry", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-harness-registration-default-"));
    container = createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });
    runtime = new AgentRuntime({
      container,
      tenantId: DEFAULT_TENANT_ID,
      home: homeDir,
      agentId: "default",
    });

    const registry = runtime.harnessBackends;
    expect(registry).toBeDefined();
    const descriptor = registry
      ? Object.getOwnPropertyDescriptor(registry, "claude_agent_sdk")
      : undefined;
    expect(typeof descriptor?.get).toBe("function");
    expect(descriptor?.value).toBeUndefined();
    expect(sdkProbe.loads).toBe(0);
  });

  it("probe control: an actual SDK import is observable", async () => {
    const before = sdkProbe.loads;
    await loadClaudeQuery();
    expect(sdkProbe.loads).toBeGreaterThan(before);
  });
});
