import { describe, expect, it, vi } from "vitest";
import type { AgentTurnRequest, AgentTurnResponse } from "@tyrum/contracts";
import { AgentRuntime, applyDeterministicContextCompactionAndToolPruning } from "../src/index.ts";

type ContextReport = { reportId: string };
type ToolDescriptor = { id: string };
type GuardianDecision = "allow" | "deny";
type GuardianCollector = { calls: number };
type SessionCompactionResult = { checkpointId: string };
type StreamResult = { id: string };
type Plugins = { name: string };
type ExecutionPort = { resumeRun(token: string): Promise<string | undefined> };
type RuntimeDeps = { shutdown: () => Promise<void> };

function createRuntime() {
  const finalizeTurnLifecycle = vi.fn(
    async (
      _context: unknown,
      input: {
        response: AgentTurnResponse;
        contextReport?: ContextReport;
        turnInput: AgentTurnRequest;
      },
    ) => input.response,
  );
  const turn = vi.fn(async () => ({
    response: { reply: "done", session_id: "session-1" } satisfies AgentTurnResponse,
    contextReport: { reportId: "ctx-1" } satisfies ContextReport,
  }));
  const turnStream = vi.fn(async () => ({
    streamResult: { id: "stream-1" } satisfies StreamResult,
    sessionId: "session-1",
    guardianReviewDecisionCollector: { calls: 1 } satisfies GuardianCollector,
    contextReport: { reportId: "ctx-stream" } satisfies ContextReport,
    finalize: async () =>
      ({ reply: "stream done", session_id: "session-1" }) satisfies AgentTurnResponse,
  }));

  const runtime = new AgentRuntime<
    RuntimeDeps,
    Plugins,
    ExecutionPort,
    ContextReport,
    ToolDescriptor,
    GuardianDecision,
    GuardianCollector,
    SessionCompactionResult,
    StreamResult
  >({
    deps: {
      shutdown: vi.fn(async () => undefined),
    },
    defaultTenantId: "tenant-default",
    resolveDefaultAgentId: () => "default",
    resolveDefaultWorkspaceId: () => "default",
    resolveHome: (agentId) => `/tmp/${agentId}`,
    executionPort: {
      resumeRun: vi.fn(async () => undefined),
    },
    lifecycle: {
      finalizeTurnLifecycle,
      status: vi.fn(async () => ({ enabled: true }) as never),
      listRegisteredTools: vi.fn(async () => ({
        allowlist: ["bash"],
        tools: [{ id: "bash" }],
        mcpServers: ["memory"],
      })),
      turn,
      turnStream,
      compactSession: vi.fn(async () => ({ checkpointId: "cp-1" })),
      executeDecideAction: vi.fn(async () => ({
        response: { reply: "decide", session_id: "session-1" } satisfies AgentTurnResponse,
        contextReport: { reportId: "ctx-decide" } satisfies ContextReport,
      })),
      executeGuardianReview: vi.fn(async () => ({
        response: { reply: "review", session_id: "session-1" } satisfies AgentTurnResponse,
        contextReport: { reportId: "ctx-review" } satisfies ContextReport,
        decision: "allow" satisfies GuardianDecision,
        calls: 2,
        invalidCalls: 0,
      })),
    },
    onShutdown: async (context) => {
      await context.deps.shutdown();
    },
  });

  return {
    runtime,
    finalizeTurnLifecycle,
    turn,
    turnStream,
  };
}

describe("@tyrum/runtime-agent AgentRuntime", () => {
  it("records the last context report after turn finalization", async () => {
    const { runtime, finalizeTurnLifecycle, turn } = createRuntime();

    const result = await runtime.turn({
      message: "hello",
    } as AgentTurnRequest);

    expect(result.reply).toBe("done");
    expect(turn).toHaveBeenCalledOnce();
    expect(finalizeTurnLifecycle).toHaveBeenCalledOnce();
    expect(runtime.getLastContextReport()).toEqual({ reportId: "ctx-1" });
  });

  it("exposes stream finalization through the same lifecycle wrapper", async () => {
    const { runtime, finalizeTurnLifecycle, turnStream } = createRuntime();

    const handle = await runtime.turnStream({
      message: "hello",
    } as AgentTurnRequest);
    const result = await handle.finalize();

    expect(handle.guardianReviewDecisionCollector).toEqual({ calls: 1 });
    expect(result.reply).toBe("stream done");
    expect(turnStream).toHaveBeenCalledOnce();
    expect(finalizeTurnLifecycle).toHaveBeenCalledOnce();
    expect(runtime.getLastContextReport()).toEqual({ reportId: "ctx-stream" });
  });

  it("keeps deterministic context pruning available from the package root", () => {
    const compacted = applyDeterministicContextCompactionAndToolPruning([
      { role: "system", content: "system" },
      { role: "user", content: "hello" },
    ]);

    expect(compacted).toHaveLength(2);
  });
});
