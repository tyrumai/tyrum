import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SqlDb } from "../../src/statestore/types.js";
import type { TurnEngineBridgeDeps } from "../../src/modules/agent/runtime/turn-engine-bridge.js";

const prepareConversationTurnRunMock = vi.hoisted(() => vi.fn());
const maybeResolvePausedTurnMock = vi.hoisted(() => vi.fn());
const claimMock = vi.hoisted(() => vi.fn());
const heartbeatMock = vi.hoisted(() => vi.fn(async () => true));
const pauseMock = vi.hoisted(() => vi.fn(async () => true));
const completeMock = vi.hoisted(() => vi.fn(async () => true));
const failMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock("../../src/modules/agent/runtime/turn-engine-bridge-execution.js", () => ({
  prepareConversationTurnRun: prepareConversationTurnRunMock,
}));

vi.mock("../../src/modules/agent/runtime/turn-engine-bridge-turn-state.js", () => ({
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

function makeDb(status: LoadedTurnStatus): SqlDb {
  const db: SqlDb = {
    kind: "sqlite",
    get: async () => status,
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
  turnDirect?: TurnEngineBridgeDeps["turnDirect"];
}): TurnEngineBridgeDeps {
  return {
    tenantId: "tenant-1",
    agentKey: "agent-1",
    workspaceKey: "workspace-1",
    identityScopeDal: {} as never,
    executionEngine: { cancelTurn: vi.fn() } as never,
    executionWorkerId: "worker-inline",
    turnEngineWaitMs: 30_000,
    approvalPollMs: 50,
    db: makeDb(input.dbStatus),
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

describe("turnViaTurnRunner", () => {
  beforeEach(() => {
    prepareConversationTurnRunMock.mockReset();
    maybeResolvePausedTurnMock.mockReset();
    maybeResolvePausedTurnMock.mockResolvedValue(false);
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
});
