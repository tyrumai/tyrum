import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlDb } from "../../src/statestore/types.js";
import type {
  TurnEngineBridgeDeps,
  TurnEngineStreamBridgeDeps,
} from "../../src/modules/agent/runtime/turn-engine-bridge.js";
import { ExecutionBackendUnavailableError } from "../../src/modules/agent/execution-backend.js";

const prepareConversationTurnRunMock = vi.hoisted(() => vi.fn());
const maybeResolvePausedTurnMock = vi.hoisted(() => vi.fn());
const loadTurnResultMock = vi.hoisted(() => vi.fn());
const claimMock = vi.hoisted(() => vi.fn());
const heartbeatMock = vi.hoisted(() => vi.fn(async () => true));
const pauseMock = vi.hoisted(() => vi.fn(async () => true));
const completeMock = vi.hoisted(() => vi.fn(async () => true));
const failMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock("../../src/modules/agent/runtime/turn-engine-bridge-execution.js", () => ({
  prepareConversationTurnRun: prepareConversationTurnRunMock,
}));

vi.mock("../../src/modules/agent/runtime/turn-engine-bridge-turn-state.js", () => ({
  loadTurnResult: loadTurnResultMock,
  maybeResolvePausedTurn: maybeResolvePausedTurnMock,
}));

vi.mock("../../src/modules/agent/runtime/turn-runner.js", () => ({
  TurnRunner: class {
    claim = claimMock;
    heartbeat = heartbeatMock;
    pause = pauseMock;
    complete = completeMock;
    fail = failMock;
  },
}));

type LoadedTurnStatus = {
  status: string;
  blocked_reason: string | null;
  blocked_detail: string | null;
  checkpoint_json: string | null;
};

function makeDb(
  status: LoadedTurnStatus,
  options?: { backendId?: "codex"; deferGet?: boolean },
): SqlDb {
  const db: SqlDb = {
    kind: "sqlite",
    get: async (sql) => {
      if (options?.deferGet) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (sql.includes("FROM conversations")) {
        return { conversation_id: "conversation-1" } as never;
      }
      if (sql.includes("FROM conversation_execution_backend_overrides")) {
        return options?.backendId
          ? ({
              tenant_id: "tenant-1",
              conversation_id: "conversation-1",
              backend_id: options.backendId,
              created_at: "2026-07-24T00:00:00.000Z",
              updated_at: "2026-07-24T00:00:00.000Z",
            } as never)
          : undefined;
      }
      return status;
    },
    all: async () => [],
    run: async () => ({ changes: 0 }),
    exec: async () => {},
    transaction: async (fn) => await fn(db),
    close: async () => {},
  };
  return db;
}

function sampleDeps(input: {
  dbStatus: LoadedTurnStatus;
  backendId?: "codex";
  deferGet?: boolean;
  turnDirect?: TurnEngineBridgeDeps["turnDirect"];
}): TurnEngineBridgeDeps {
  return {
    tenantId: "tenant-1",
    agentKey: "agent-1",
    workspaceKey: "workspace-1",
    identityScopeDal: {} as never,
    turnController: {} as never,
    executionWorkerId: "worker-inline",
    turnEngineWaitMs: 30_000,
    approvalPollMs: 50,
    db: makeDb(input.dbStatus, {
      backendId: input.backendId,
      deferGet: input.deferGet,
    }),
    approvalDal: {} as never,
    conversationNodeAttachmentDal: {} as never,
    redactText: (text) => text,
    redactUnknown: <T>(value: T) => value,
    resolveExecutionProfile: vi.fn() as never,
    turnDirect:
      input.turnDirect ??
      (vi.fn(async () => ({ reply: "ok" })) as unknown as TurnEngineBridgeDeps["turnDirect"]),
    resolveAgentTurnInput: vi.fn() as never,
    resolveConversationQueueTarget: vi.fn() as never,
    resolveTurnRequestId: vi.fn() as never,
    isToolExecutionApprovalRequiredError: vi.fn(() => false),
  };
}

function sampleStreamDeps(input: {
  backendId?: "codex";
  dbStatus: LoadedTurnStatus;
  deferGet?: boolean;
  turnDirect?: TurnEngineBridgeDeps["turnDirect"];
}): TurnEngineStreamBridgeDeps {
  return {
    ...sampleDeps(input),
    turnStream: vi.fn(async () => ({
      finalize: async () => ({ reply: "ok" }),
      streamResult: {
        toUIMessageStream: () => new ReadableStream(),
      },
    })) as TurnEngineStreamBridgeDeps["turnStream"],
  };
}

describe("turnViaTurnRunner", () => {
  beforeEach(() => {
    prepareConversationTurnRunMock.mockReset();
    maybeResolvePausedTurnMock.mockReset();
    maybeResolvePausedTurnMock.mockResolvedValue(false);
    loadTurnResultMock.mockReset();
    loadTurnResultMock.mockResolvedValue(undefined);
    claimMock.mockReset();
    heartbeatMock.mockReset();
    heartbeatMock.mockResolvedValue(true);
    pauseMock.mockReset();
    pauseMock.mockResolvedValue(true);
    completeMock.mockReset();
    completeMock.mockResolvedValue(true);
    failMock.mockReset();
    failMock.mockResolvedValue(true);

    prepareConversationTurnRunMock.mockResolvedValue({
      deadlineMs: Date.now() + 5_000,
      key: "agent:default:test:default:channel:thread-1",
      planId: "plan-1",
      turnId: "turn-1",
      workerId: "worker-1",
      startMs: Date.now(),
    });
  });

  it("surfaces blocked detail when claim sees a terminal cancelled turn", async () => {
    claimMock.mockResolvedValue({ kind: "terminal", status: "cancelled" });

    const deps = sampleDeps({
      dbStatus: {
        status: "cancelled",
        blocked_reason: "policy",
        blocked_detail: "approval denied by operator",
        checkpoint_json: null,
      },
    });

    const { turnViaTurnRunner } =
      await import("../../src/modules/agent/runtime/turn-via-turn-runner.js");

    await expect(
      turnViaTurnRunner(deps, {
        channel: "test",
        thread_id: "thread-1",
        message: "hello",
      } as never),
    ).rejects.toThrow("approval denied by operator");

    expect(completeMock).not.toHaveBeenCalled();
  });

  it("does not return success when complete loses the turn to cancellation", async () => {
    claimMock.mockResolvedValue({
      kind: "claimed",
      turn: {
        status: "running",
      },
    });
    completeMock.mockResolvedValue(false);

    const turnDirect = vi.fn(async () => ({ reply: "ok" }));
    const deps = sampleDeps({
      dbStatus: {
        status: "cancelled",
        blocked_reason: "approval",
        blocked_detail: "approval expired before completion",
        checkpoint_json: null,
      },
      turnDirect: turnDirect as unknown as TurnEngineBridgeDeps["turnDirect"],
    });

    const { turnViaTurnRunner } =
      await import("../../src/modules/agent/runtime/turn-via-turn-runner.js");

    await expect(
      turnViaTurnRunner(deps, {
        channel: "test",
        thread_id: "thread-1",
        message: "hello",
      } as never),
    ).rejects.toThrow("approval expired before completion");

    expect(turnDirect).toHaveBeenCalledOnce();
    expect(failMock).not.toHaveBeenCalled();
  });

  it("returns the persisted result when the turn already succeeded at the timeout boundary", async () => {
    prepareConversationTurnRunMock.mockResolvedValue({
      deadlineMs: Date.now() - 1,
      key: "agent:default:test:default:channel:thread-1",
      planId: "plan-1",
      turnId: "turn-1",
      workerId: "worker-1",
      startMs: Date.now() - 10,
    });
    loadTurnResultMock.mockResolvedValue({ reply: "persisted" });

    const deps = sampleDeps({
      dbStatus: {
        status: "succeeded",
        blocked_reason: null,
        blocked_detail: null,
        checkpoint_json: null,
      },
    });

    const { turnViaTurnRunner } =
      await import("../../src/modules/agent/runtime/turn-via-turn-runner.js");

    await expect(
      turnViaTurnRunner(deps, {
        channel: "test",
        thread_id: "thread-1",
        message: "hello",
      } as never),
    ).resolves.toEqual({ reply: "persisted" });

    expect(loadTurnResultMock).toHaveBeenCalledWith(deps, "turn-1");
  });

  it("records an unavailable backend as a typed turn failure", async () => {
    claimMock.mockResolvedValue({
      kind: "claimed",
      turn: {
        status: "running",
      },
    });
    const turnDirect = vi.fn();
    const deps = sampleDeps({
      backendId: "codex",
      dbStatus: {
        status: "running",
        blocked_reason: null,
        blocked_detail: null,
        checkpoint_json: null,
      },
      turnDirect: turnDirect as TurnEngineBridgeDeps["turnDirect"],
    });

    const { turnViaTurnRunner } =
      await import("../../src/modules/agent/runtime/turn-via-turn-runner.js");
    const turn = turnViaTurnRunner(deps, {
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
    } as never);

    await expect(turn).rejects.toBeInstanceOf(ExecutionBackendUnavailableError);
    expect(failMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        turnId: "turn-1",
        error: "execution backend 'codex' is not available yet (ARCH-22 Phase 0)",
      }),
    );
    expect(turnDirect).not.toHaveBeenCalled();
  });
});

describe("turnViaTurnRunnerStream", () => {
  beforeEach(() => {
    prepareConversationTurnRunMock.mockReset();
    maybeResolvePausedTurnMock.mockReset();
    maybeResolvePausedTurnMock.mockResolvedValue(false);
    loadTurnResultMock.mockReset();
    loadTurnResultMock.mockResolvedValue(undefined);
    claimMock.mockReset();
    heartbeatMock.mockReset();
    heartbeatMock.mockResolvedValue(true);
    pauseMock.mockReset();
    pauseMock.mockResolvedValue(true);
    completeMock.mockReset();
    completeMock.mockResolvedValue(true);
    failMock.mockReset();
    failMock.mockResolvedValue(true);

    prepareConversationTurnRunMock.mockResolvedValue({
      deadlineMs: Date.now() + 5_000,
      key: "agent:default:test:default:channel:thread-1",
      planId: "plan-1",
      turnId: "turn-1",
      workerId: "worker-1",
      startMs: Date.now(),
    });
  });

  it("rejects outcome when claim sees a terminal cancelled turn", async () => {
    claimMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { kind: "terminal", status: "cancelled" };
    });

    const deps = sampleStreamDeps({
      dbStatus: {
        status: "cancelled",
        blocked_reason: "policy",
        blocked_detail: "approval denied by operator",
        checkpoint_json: null,
      },
    });

    const { turnViaTurnRunnerStream } =
      await import("../../src/modules/agent/runtime/turn-via-turn-runner.js");

    const handle = await turnViaTurnRunnerStream(deps, {
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
    } as never);

    const finalize = expect(handle.finalize()).rejects.toThrow("approval denied by operator");
    const outcome = expect(handle.outcome).rejects.toThrow("approval denied by operator");

    await finalize;
    await outcome;
  });

  it("rejects outcome when the timeout boundary finds a failed turn", async () => {
    prepareConversationTurnRunMock.mockResolvedValue({
      deadlineMs: Date.now() - 1,
      key: "agent:default:test:default:channel:thread-1",
      planId: "plan-1",
      turnId: "turn-1",
      workerId: "worker-1",
      startMs: Date.now() - 10,
    });

    const deps = sampleStreamDeps({
      dbStatus: {
        status: "failed",
        blocked_reason: "executor_failed",
        blocked_detail: "model call failed",
        checkpoint_json: null,
      },
      deferGet: true,
    });

    const { turnViaTurnRunnerStream } =
      await import("../../src/modules/agent/runtime/turn-via-turn-runner.js");

    const handle = await turnViaTurnRunnerStream(deps, {
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
    } as never);

    const finalize = expect(handle.finalize()).rejects.toThrow("model call failed");
    const outcome = expect(handle.outcome).rejects.toThrow("model call failed");

    await finalize;
    await outcome;
  });

  it("records an unavailable backend before starting the native stream", async () => {
    claimMock.mockResolvedValue({
      kind: "claimed",
      turn: {
        status: "running",
      },
    });
    const deps = sampleStreamDeps({
      backendId: "codex",
      dbStatus: {
        status: "running",
        blocked_reason: null,
        blocked_detail: null,
        checkpoint_json: null,
      },
    });

    const { turnViaTurnRunnerStream } =
      await import("../../src/modules/agent/runtime/turn-via-turn-runner.js");
    const handle = await turnViaTurnRunnerStream(deps, {
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
    } as never);

    const finalize = expect(handle.finalize()).rejects.toBeInstanceOf(
      ExecutionBackendUnavailableError,
    );
    const outcome = expect(handle.outcome).rejects.toBeInstanceOf(ExecutionBackendUnavailableError);
    await finalize;
    await outcome;

    expect(failMock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "execution backend 'codex' is not available yet (ARCH-22 Phase 0)",
      }),
    );
    expect(deps.turnStream).not.toHaveBeenCalled();
  });
});
