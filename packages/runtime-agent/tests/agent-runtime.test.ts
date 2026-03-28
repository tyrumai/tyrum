import { describe, expect, it, vi } from "vitest";
import type { AgentTurnRequest, AgentTurnResponse } from "@tyrum/contracts";
import type {
  AgentRuntimeLifecycle,
  AgentRuntimeOptions,
  AgentRuntimeToolCatalog,
} from "../src/index.ts";
import { AgentRuntime } from "../src/index.ts";

type ContextReport = { reportId: string };
type ToolDescriptor = { id: string };
type GuardianDecision = "allow" | "deny";
type GuardianCollector = { calls: number };
type ConversationCompactionResult = { checkpointId: string };
type StreamResult = { id: string };
type Plugins = { name: string };
type ExecutionPort = { resumeRun(token: string): Promise<string | undefined> };
type RuntimeDeps = { shutdown: () => Promise<void> };

type RuntimeLifecycle = AgentRuntimeLifecycle<
  RuntimeDeps,
  Plugins,
  ExecutionPort,
  ContextReport,
  ToolDescriptor,
  GuardianDecision,
  GuardianCollector,
  ConversationCompactionResult,
  StreamResult
>;

type RuntimeOptions = AgentRuntimeOptions<
  RuntimeDeps,
  Plugins,
  ExecutionPort,
  ContextReport,
  ToolDescriptor,
  GuardianDecision,
  GuardianCollector,
  ConversationCompactionResult,
  StreamResult
>;

function makeResponse(reply: string): AgentTurnResponse {
  return { reply, conversation_id: "conversation-1" };
}

function createRuntime(
  overrides: {
    options?: Partial<RuntimeOptions>;
    lifecycle?: Partial<RuntimeLifecycle>;
  } = {},
) {
  const finalizeTurnLifecycle =
    overrides.lifecycle?.finalizeTurnLifecycle ??
    vi.fn(
      async (
        _context,
        input: {
          response: AgentTurnResponse;
          contextReport?: ContextReport;
          turnInput: AgentTurnRequest;
        },
      ) => input.response,
    );
  const status = overrides.lifecycle?.status ?? vi.fn(async () => ({ enabled: true }) as never);
  const listRegisteredTools =
    overrides.lifecycle?.listRegisteredTools ??
    vi.fn(async () => ({
      allowlist: ["bash"],
      tools: [{ id: "bash" }],
      mcpServers: ["memory"],
    }));
  const turn =
    overrides.lifecycle?.turn ??
    vi.fn(async () => ({
      response: makeResponse("done"),
      contextReport: { reportId: "ctx-1" } satisfies ContextReport,
    }));
  const turnStream =
    overrides.lifecycle?.turnStream ??
    vi.fn(async () => ({
      streamResult: { id: "stream-1" } satisfies StreamResult,
      conversationId: "conversation-1",
      guardianReviewDecisionCollector: { calls: 1 } satisfies GuardianCollector,
      contextReport: { reportId: "ctx-stream" } satisfies ContextReport,
      finalize: async () => makeResponse("stream done"),
    }));
  const compactConversation =
    overrides.lifecycle?.compactConversation ??
    vi.fn(async () => ({ checkpointId: "cp-1" }) satisfies ConversationCompactionResult);
  const executeDecideAction =
    overrides.lifecycle?.executeDecideAction ??
    vi.fn(async () => ({
      response: makeResponse("decide"),
      contextReport: { reportId: "ctx-decide" } satisfies ContextReport,
    }));
  const executeGuardianReview =
    overrides.lifecycle?.executeGuardianReview ??
    vi.fn(async () => ({
      response: makeResponse("review"),
      contextReport: { reportId: "ctx-review" } satisfies ContextReport,
      decision: "allow" satisfies GuardianDecision,
      calls: 2,
      invalidCalls: 0,
    }));

  const lifecycle: RuntimeLifecycle = {
    finalizeTurnLifecycle,
    status,
    listRegisteredTools,
    turn,
    turnStream,
    compactConversation,
    executeDecideAction,
    executeGuardianReview,
  };

  const shutdownDep = vi.fn(async () => undefined);
  const executionPort = {
    resumeRun: vi.fn(async () => undefined),
  } satisfies ExecutionPort;
  const onShutdown =
    overrides.options?.onShutdown ??
    vi.fn(async (context) => {
      await context.deps.shutdown();
    });

  const runtime = new AgentRuntime<
    RuntimeDeps,
    Plugins,
    ExecutionPort,
    ContextReport,
    ToolDescriptor,
    GuardianDecision,
    GuardianCollector,
    ConversationCompactionResult,
    StreamResult
  >({
    deps: {
      shutdown: shutdownDep,
    },
    defaultTenantId: "tenant-default",
    resolveDefaultAgentId: () => "default",
    resolveDefaultWorkspaceId: () => "default",
    resolveHome: (agentId) => `/tmp/${agentId}`,
    executionPort,
    lifecycle,
    onShutdown,
    ...overrides.options,
  });

  return {
    runtime,
    lifecycle: {
      finalizeTurnLifecycle,
      status,
      listRegisteredTools,
      turn,
      turnStream,
      compactConversation,
      executeDecideAction,
      executeGuardianReview,
    },
    shutdownDep,
    executionPort,
    onShutdown,
  };
}

describe("@tyrum/runtime-agent AgentRuntime", () => {
  it("rejects invalid agent ids", () => {
    expect(() =>
      createRuntime({
        options: {
          agentId: "bad:agent",
        },
      }),
    ).toThrow(/invalid agent_id/i);
  });

  it("rejects invalid workspace ids", () => {
    expect(() =>
      createRuntime({
        options: {
          workspaceId: "bad:workspace",
        },
      }),
    ).toThrow(/invalid workspace_id/i);
  });

  it("trims explicit identity values and clamps timing settings", () => {
    const { runtime } = createRuntime({
      options: {
        agentId: " agent-1 ",
        workspaceId: " workspace-1 ",
        tenantId: " tenant-1 ",
        instanceOwner: " owner-1 ",
        home: "/tmp/custom-home",
        plugins: { name: "plugin-a" },
        approvalWaitMs: 1,
        approvalPollMs: 1,
        turnEngineWaitMs: 0,
      },
    });

    expect(runtime.instanceOwner).toBe("owner-1");
    expect(runtime.getContext()).toMatchObject({
      agentId: "agent-1",
      workspaceId: "workspace-1",
      tenantId: "tenant-1",
      home: "/tmp/custom-home",
      approvalWaitMs: 1_000,
      approvalPollMs: 100,
      turnEngineWaitMs: 1,
      plugins: { name: "plugin-a" },
    });
  });

  it("exposes a generated instance owner when one is not configured", () => {
    const { runtime } = createRuntime();

    expect(runtime.instanceOwner).toMatch(/^instance-/);
    expect(runtime.getContext().instanceOwner).toBe(runtime.instanceOwner);
  });

  it("delegates status and listRegisteredTools with the runtime context", async () => {
    const { runtime, lifecycle } = createRuntime();
    const expectedCatalog: AgentRuntimeToolCatalog<ToolDescriptor> = {
      allowlist: ["bash"],
      tools: [{ id: "bash" }],
      mcpServers: ["memory"],
    };
    lifecycle.listRegisteredTools.mockResolvedValueOnce(expectedCatalog);

    const statusResult = await runtime.status(true);
    const toolsResult = await runtime.listRegisteredTools();

    expect(statusResult).toEqual({ enabled: true });
    expect(lifecycle.status).toHaveBeenCalledWith(runtime.getContext(), true);
    expect(toolsResult).toEqual(expectedCatalog);
    expect(lifecycle.listRegisteredTools).toHaveBeenCalledWith(runtime.getContext());
  });

  it("exposes normalized runtime context through package-owned accessors", () => {
    const plugins = { name: "plugin-a" } satisfies Plugins;
    const { runtime, executionPort } = createRuntime({
      options: {
        agentId: " agent-1 ",
        workspaceId: " workspace-1 ",
        tenantId: " tenant-1 ",
        home: "/tmp/custom-home",
        plugins,
        maxSteps: 9,
        approvalWaitMs: 2_000,
        approvalPollMs: 250,
        turnEngineWaitMs: 9_000,
      },
    });

    runtime.cleanupAtMs = 42;

    expect(runtime.deps.shutdown).toBeTypeOf("function");
    expect(runtime.executionPort).toBe(executionPort);
    expect(runtime.home).toBe("/tmp/custom-home");
    expect(runtime.tenantId).toBe("tenant-1");
    expect(runtime.agentId).toBe("agent-1");
    expect(runtime.workspaceId).toBe("workspace-1");
    expect(runtime.plugins).toBe(plugins);
    expect(runtime.maxSteps).toBe(9);
    expect(runtime.approvalWaitMs).toBe(2_000);
    expect(runtime.approvalPollMs).toBe(250);
    expect(runtime.turnEngineWaitMs).toBe(9_000);
    expect(runtime.executionWorkerId).toMatch(/^agent-runtime-agent-1-/);
    expect(runtime.cleanupAtMs).toBe(42);
    expect(runtime.defaultHeartbeatSeededScopes.size).toBe(0);
  });

  it("delegates compactConversation inputs unchanged", async () => {
    const { runtime, lifecycle } = createRuntime();
    const abortController = new AbortController();
    const input = {
      conversationId: "conversation-9",
      keepLastMessages: 5,
      abortSignal: abortController.signal,
      timeoutMs: 2_500,
    };

    const result = await runtime.compactConversation(input);

    expect(result).toEqual({ checkpointId: "cp-1" });
    expect(lifecycle.compactConversation).toHaveBeenCalledWith(runtime.getContext(), input);
  });

  it("calls onShutdown with the runtime context", async () => {
    const { runtime, onShutdown, shutdownDep } = createRuntime();

    await runtime.shutdown();

    expect(onShutdown).toHaveBeenCalledWith(runtime.getContext());
    expect(shutdownDep).toHaveBeenCalledOnce();
  });

  it("records the last context report after turn finalization", async () => {
    const { runtime, lifecycle } = createRuntime();
    const request = { message: "hello" } as AgentTurnRequest;

    const result = await runtime.turn(request);

    expect(result.reply).toBe("done");
    expect(lifecycle.turn).toHaveBeenCalledWith(runtime.getContext(), request);
    expect(lifecycle.finalizeTurnLifecycle).toHaveBeenCalledOnce();
    expect(runtime.getLastContextReport()).toEqual({ reportId: "ctx-1" });
  });

  it("preserves the previous context report when turn returns no new report", async () => {
    const { runtime, lifecycle } = createRuntime();
    lifecycle.turn
      .mockResolvedValueOnce({
        response: makeResponse("first"),
        contextReport: { reportId: "ctx-first" } satisfies ContextReport,
      })
      .mockResolvedValueOnce({
        response: makeResponse("second"),
      });

    await runtime.turn({ message: "first" } as AgentTurnRequest);
    await runtime.turn({ message: "second" } as AgentTurnRequest);

    expect(runtime.getLastContextReport()).toEqual({ reportId: "ctx-first" });
  });

  it("exposes stream finalization through the same lifecycle wrapper", async () => {
    const { runtime, lifecycle } = createRuntime();
    const request = { message: "hello" } as AgentTurnRequest;

    const handle = await runtime.turnStream(request);
    const result = await handle.finalize();

    expect(handle.guardianReviewDecisionCollector).toEqual({ calls: 1 });
    expect(result.reply).toBe("stream done");
    expect(lifecycle.turnStream).toHaveBeenCalledWith(runtime.getContext(), request);
    expect(lifecycle.finalizeTurnLifecycle).toHaveBeenCalledOnce();
    expect(runtime.getLastContextReport()).toEqual({ reportId: "ctx-stream" });
  });

  it("preserves the previous context report when stream handles omit it", async () => {
    const { runtime, lifecycle } = createRuntime();
    lifecycle.turnStream
      .mockResolvedValueOnce({
        streamResult: { id: "stream-1" } satisfies StreamResult,
        conversationId: "conversation-1",
        guardianReviewDecisionCollector: { calls: 1 } satisfies GuardianCollector,
        contextReport: { reportId: "ctx-stream-1" } satisfies ContextReport,
        finalize: async () => makeResponse("stream one"),
      })
      .mockResolvedValueOnce({
        streamResult: { id: "stream-2" } satisfies StreamResult,
        conversationId: "conversation-2",
        guardianReviewDecisionCollector: { calls: 2 } satisfies GuardianCollector,
        finalize: async () => makeResponse("stream two"),
      });

    const first = await runtime.turnStream({ message: "first" } as AgentTurnRequest);
    await first.finalize();
    const second = await runtime.turnStream({ message: "second" } as AgentTurnRequest);
    await second.finalize();

    expect(runtime.getLastContextReport()).toEqual({ reportId: "ctx-stream-1" });
  });

  it("finalizes decide actions and updates the last context report", async () => {
    const { runtime, lifecycle } = createRuntime();
    const request = { message: "decide" } as AgentTurnRequest;
    const opts = { timeoutMs: 500, execution: { kind: "automation" } };

    const result = await runtime.executeDecideAction(request, opts);

    expect(result.reply).toBe("decide");
    expect(lifecycle.executeDecideAction).toHaveBeenCalledWith(runtime.getContext(), request, opts);
    expect(lifecycle.finalizeTurnLifecycle).toHaveBeenLastCalledWith(runtime.getContext(), {
      turnInput: request,
      response: makeResponse("decide"),
      contextReport: { reportId: "ctx-decide" },
    });
    expect(runtime.getLastContextReport()).toEqual({ reportId: "ctx-decide" });
  });

  it("finalizes guardian reviews and preserves decision metadata", async () => {
    const { runtime, lifecycle } = createRuntime();
    const request = { message: "review" } as AgentTurnRequest;
    const opts = { timeoutMs: 250 };
    lifecycle.executeGuardianReview.mockResolvedValueOnce({
      response: makeResponse("guardian"),
      contextReport: { reportId: "ctx-guardian" } satisfies ContextReport,
      decision: "deny" satisfies GuardianDecision,
      calls: 4,
      invalidCalls: 1,
      error: "missing evidence",
    });

    const result = await runtime.executeGuardianReview(request, opts);

    expect(lifecycle.executeGuardianReview).toHaveBeenCalledWith(
      runtime.getContext(),
      request,
      opts,
    );
    expect(result).toEqual({
      response: makeResponse("guardian"),
      decision: "deny",
      calls: 4,
      invalidCalls: 1,
      error: "missing evidence",
    });
    expect(runtime.getLastContextReport()).toEqual({ reportId: "ctx-guardian" });
  });

  it("sets plugins on the mutable runtime context", () => {
    const { runtime } = createRuntime({
      options: {
        plugins: { name: "initial" },
      },
    });

    runtime.setPlugins({ name: "updated" });

    expect(runtime.getContext().plugins).toEqual({ name: "updated" });
  });
});
