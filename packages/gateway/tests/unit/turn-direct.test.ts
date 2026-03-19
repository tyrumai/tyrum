import { beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.hoisted(() => vi.fn());
const streamTextMock = vi.hoisted(() => vi.fn());
const prepareTurnMock = vi.hoisted(() => vi.fn());
const finalizeTurnMock = vi.hoisted(() => vi.fn());
const compactForOverflowMock = vi.hoisted(() => vi.fn());
const maybeAutoCompactSessionMock = vi.hoisted(() => vi.fn());
const extractToolApprovalResumeStateMock = vi.hoisted(() => vi.fn(() => undefined));
const sessionMessagesToModelMessagesMock = vi.hoisted(() => vi.fn(async () => []));
const buildPromptVisibleMessagesMock = vi.hoisted(() => vi.fn((messages: unknown) => messages));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: generateTextMock,
    streamText: streamTextMock,
  };
});

vi.mock("../../src/modules/agent/runtime/turn-preparation.js", () => ({
  prepareTurn: prepareTurnMock,
}));

vi.mock("../../src/modules/agent/runtime/turn-finalization.js", () => ({
  finalizeTurn: finalizeTurnMock,
}));

vi.mock("../../src/modules/agent/runtime/turn-direct-runtime-helpers.js", () => ({
  createStopWhenWithWithinTurnLoopDetection: vi.fn(() => ({
    stopWhen: [],
    withinTurnLoop: { value: undefined },
  })),
  compactForOverflow: compactForOverflowMock,
  makeEventfulAbortSignal: vi.fn((signal?: AbortSignal) => signal),
  maybeAutoCompactSession: maybeAutoCompactSessionMock,
  prepareLaneQueueStep: vi.fn(() => ({ messages: [] })),
  resolveTurnReply: vi.fn((reply: string) => reply),
}));

vi.mock("../../src/modules/agent/runtime/turn-helpers.js", () => ({
  createStaticLanguageModelV3: vi.fn(),
  extractToolApprovalResumeState: extractToolApprovalResumeStateMock,
  isStatusQuery: vi.fn(() => false),
}));

vi.mock("../../src/modules/agent/runtime/turn-direct-helpers.js", () => ({
  handleStatusQuery: vi.fn(),
  throwToolApprovalError: vi.fn(),
}));

vi.mock("../../src/modules/agent/runtime/intake-delegation.js", () => ({
  delegateFromIntake: vi.fn(),
  handleIntakeModeDecision: vi.fn(async () => null),
  resolveIntakeDecision: vi.fn(async () => ({ mode: "continue" })),
}));

vi.mock("../../src/modules/agent/runtime/automation-delivery.js", () => ({
  resolveAutomationMetadata: vi.fn(() => null),
}));

vi.mock("../../src/modules/ai-sdk/message-utils.js", () => ({
  appendToolApprovalResponseMessage: vi.fn((messages: unknown) => messages),
  countAssistantMessages: vi.fn(() => 0),
  sessionMessagesToModelMessages: sessionMessagesToModelMessagesMock,
}));

vi.mock("../../src/modules/agent/runtime/context-pruning.js", () => ({
  applyDeterministicContextCompactionAndToolPruning: vi.fn((messages: unknown) => messages),
}));

vi.mock("../../src/modules/agent/runtime/session-context-state.js", () => ({
  buildPromptVisibleMessages: buildPromptVisibleMessagesMock,
}));

vi.mock("../../src/modules/agent/runtime/session-compaction-service.js", () => ({
  isContextOverflowError: vi.fn(
    (error: unknown) => error instanceof Error && error.message.includes("maximum context length"),
  ),
}));

function samplePreparedTurn(usedTools: Set<string>) {
  return {
    ctx: {
      config: {
        sessions: {
          context_pruning: {},
          loop_detection: {
            within_turn: {
              enabled: false,
              consecutive_repeat_limit: 3,
              cycle_repeat_limit: 3,
            },
          },
        },
      },
    },
    executionProfile: {},
    session: {
      tenant_id: "tenant-1",
      session_id: "session-1",
      agent_id: "agent-1",
      workspace_id: "workspace-1",
      messages: [],
      context_state: {
        version: 1,
        recent_message_ids: [],
        checkpoint: null,
        pending_approvals: [],
        pending_tool_state: [],
        updated_at: "2026-03-13T00:00:00.000Z",
      },
    },
    mainLaneSessionKey: "agent:default:ui:main",
    model: {},
    modelResolution: { candidates: [] },
    toolSet: {},
    toolCallPolicyStates: new Map(),
    laneQueue: undefined,
    usedTools,
    memoryWriteState: { wrote: false },
    userContent: [{ type: "text", text: "hello" }],
    rewriteHistoryAttachmentsForModel: false,
    contextReport: {
      session_id: "session-1",
      thread_id: "thread-1",
      channel: "ui",
      tool_calls: [],
      injected_files: [],
    },
    systemPrompt: "system",
    resolved: {
      message: "hello",
      channel: "ui",
      thread_id: "thread-1",
      metadata: undefined,
    },
    turnMemoryDecisionCollector: {},
  } as never;
}

function sampleDeps() {
  return {
    opts: {
      container: {
        logger: { warn: vi.fn() },
        deploymentConfig: {
          attachments: {
            maxAnalysisBytes: 20 * 1024 * 1024,
          },
        },
      },
    },
    prepareTurnDeps: {
      fetchImpl: fetch,
    },
    sessionDal: {
      getById: vi.fn(async () => ({
        tenant_id: "tenant-1",
        session_id: "session-1",
        agent_id: "agent-1",
        workspace_id: "workspace-1",
        messages: [],
        context_state: {
          version: 1,
          recent_message_ids: [],
          checkpoint: null,
          pending_approvals: [],
          pending_tool_state: [],
          updated_at: "2026-03-13T00:00:00.000Z",
        },
      })),
    },
    approvalDal: {},
    agentId: "agent-1",
    workspaceId: "workspace-1",
    maxSteps: 4,
  } as never;
}

describe("turnDirect overflow retry", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    streamTextMock.mockReset();
    prepareTurnMock.mockReset();
    finalizeTurnMock.mockReset();
    compactForOverflowMock.mockReset();
    maybeAutoCompactSessionMock.mockReset();
    extractToolApprovalResumeStateMock.mockReset();
    extractToolApprovalResumeStateMock.mockReturnValue(undefined);
    sessionMessagesToModelMessagesMock.mockReset();
    sessionMessagesToModelMessagesMock.mockResolvedValue([]);
    buildPromptVisibleMessagesMock.mockReset();
    buildPromptVisibleMessagesMock.mockImplementation((messages: unknown) => messages);
  });

  it("compacts but does not retry after tools have already been used", async () => {
    const overflow = new Error("This model's maximum context length is 128000 tokens.");
    prepareTurnMock.mockResolvedValue(samplePreparedTurn(new Set(["write_file"])));
    generateTextMock.mockRejectedValue(overflow);

    const { turnDirect } = await import("../../src/modules/agent/runtime/turn-direct.js");

    await expect(
      turnDirect(sampleDeps(), { channel: "ui", thread_id: "thread-1", message: "hello" } as never),
    ).rejects.toThrow(/maximum context length/);

    expect(compactForOverflowMock).toHaveBeenCalledOnce();
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it("retries once after compaction when no tools have run yet", async () => {
    prepareTurnMock.mockResolvedValue(samplePreparedTurn(new Set()));
    generateTextMock
      .mockRejectedValueOnce(new Error("This model's maximum context length is 128000 tokens."))
      .mockResolvedValueOnce({
        text: "ok",
        steps: [],
        totalUsage: undefined,
        response: { messages: [] },
      });
    finalizeTurnMock.mockResolvedValue({ reply: "ok" });

    const { turnDirect } = await import("../../src/modules/agent/runtime/turn-direct.js");

    const result = await turnDirect(sampleDeps(), {
      channel: "ui",
      thread_id: "thread-1",
      message: "hello",
    } as never);

    expect(compactForOverflowMock).toHaveBeenCalledOnce();
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(result.response).toEqual({ reply: "ok" });
  });

  it("strips embedded session context when checkpoint state is injected separately", async () => {
    const refreshedContextState = {
      version: 1,
      recent_message_ids: [],
      checkpoint: {
        goal: "continue task",
        user_constraints: [],
        decisions: [],
        discoveries: [],
        completed_work: [],
        pending_work: [],
        unresolved_questions: [],
        critical_identifiers: [],
        relevant_files: [],
        handoff_md: "Continue the task.",
      },
      pending_approvals: [],
      pending_tool_state: [],
      updated_at: "2026-03-13T00:00:00.000Z",
    };
    prepareTurnMock.mockResolvedValue({
      ...samplePreparedTurn(new Set()),
      userContent: [
        { type: "text", text: "Skill guidance:\nnone" },
        { type: "text", text: "Session state:\nstale checkpoint text" },
        { type: "text", text: "hello" },
      ],
    });
    generateTextMock.mockResolvedValue({
      text: "ok",
      steps: [],
      totalUsage: undefined,
      response: { messages: [] },
    });
    finalizeTurnMock.mockResolvedValue({ reply: "ok" });

    const deps = sampleDeps();
    deps.sessionDal.getById = vi.fn(async () => ({
      tenant_id: "tenant-1",
      session_id: "session-1",
      agent_id: "agent-1",
      workspace_id: "workspace-1",
      messages: [],
      context_state: refreshedContextState,
    }));

    const { turnDirect } = await import("../../src/modules/agent/runtime/turn-direct.js");

    await turnDirect(deps, {
      channel: "ui",
      thread_id: "thread-1",
      message: "hello",
    } as never);

    const call = generateTextMock.mock.calls[0]?.[0];
    const userMessage = Array.isArray(call?.messages) ? call.messages.at(-1) : undefined;
    expect(buildPromptVisibleMessagesMock).toHaveBeenCalledWith([], refreshedContextState);
    expect(userMessage).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: "Skill guidance:\nnone" },
        { type: "text", text: "hello" },
      ],
    });
    expect(JSON.stringify(call?.messages ?? [])).not.toContain("stale checkpoint text");
  });

  it("rewrites persisted attachment history when helper mode strips raw file parts", async () => {
    prepareTurnMock.mockResolvedValue({
      ...samplePreparedTurn(new Set()),
      rewriteHistoryAttachmentsForModel: true,
    });
    generateTextMock.mockResolvedValue({
      text: "ok",
      steps: [],
      totalUsage: undefined,
      response: { messages: [] },
    });
    finalizeTurnMock.mockResolvedValue({ reply: "ok" });

    const deps = sampleDeps();
    const persistedMessages = [
      {
        id: "user-1",
        role: "user",
        parts: [
          { type: "text", text: "Please inspect this." },
          {
            type: "file",
            url: "https://example.com/screenshot.png",
            mediaType: "image/png",
            filename: "screenshot.png",
          },
        ],
      },
    ];
    deps.sessionDal.getById = vi.fn(async () => ({
      tenant_id: "tenant-1",
      session_id: "session-1",
      agent_id: "agent-1",
      workspace_id: "workspace-1",
      messages: persistedMessages,
      context_state: {
        version: 1,
        recent_message_ids: [],
        checkpoint: null,
        pending_approvals: [],
        pending_tool_state: [],
        updated_at: "2026-03-13T00:00:00.000Z",
      },
    }));

    const { turnDirect } = await import("../../src/modules/agent/runtime/turn-direct.js");

    await turnDirect(deps, {
      channel: "ui",
      thread_id: "thread-1",
      message: "hello",
    } as never);

    expect(sessionMessagesToModelMessagesMock).toHaveBeenCalledWith([
      {
        id: "user-1",
        role: "user",
        parts: [
          {
            type: "text",
            text: "Please inspect this.",
          },
          {
            type: "text",
            text: "Attachments:\n- filename=screenshot.png mime_type=image/png",
          },
        ],
      },
    ]);
  });
});

describe("turnDirect approval resume state", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    prepareTurnMock.mockReset();
    finalizeTurnMock.mockReset();
    maybeAutoCompactSessionMock.mockReset();
    extractToolApprovalResumeStateMock.mockReset();
  });

  it("restores memory_written from approval resume state", async () => {
    prepareTurnMock.mockResolvedValue(samplePreparedTurn(new Set()));
    extractToolApprovalResumeStateMock.mockReturnValue({
      approval_id: "approval-1",
      messages: [],
      memory_written: true,
      used_tools: [],
      steps_used: 0,
    });
    generateTextMock.mockResolvedValue({
      text: "ok",
      steps: [],
      totalUsage: undefined,
      response: { messages: [] },
    });
    finalizeTurnMock.mockResolvedValue({ reply: "ok" });

    const deps = sampleDeps();
    deps.approvalDal = {
      getById: vi.fn(async () => ({
        status: "approved",
        context: {},
        resolution: null,
      })),
    } as never;

    const { turnDirect } = await import("../../src/modules/agent/runtime/turn-direct.js");

    await turnDirect(deps, { channel: "ui", thread_id: "thread-1", message: "hello" } as never, {
      execution: { stepApprovalId: "approval-1" } as never,
    });

    expect(finalizeTurnMock).toHaveBeenCalledWith(expect.objectContaining({ memoryWritten: true }));
  });
});

describe("turnStreamDirect overflow handling", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
    prepareTurnMock.mockReset();
    finalizeTurnMock.mockReset();
    compactForOverflowMock.mockReset();
    maybeAutoCompactSessionMock.mockReset();
  });

  it("compacts and rethrows when stream finalization hits context overflow", async () => {
    prepareTurnMock.mockResolvedValue(samplePreparedTurn(new Set()));
    const overflow = new Error("This model's maximum context length is 128000 tokens.");
    const rejected = Promise.reject(overflow);
    rejected.catch(() => undefined);
    streamTextMock.mockReturnValue(rejected as never);

    const { turnStreamDirect } = await import("../../src/modules/agent/runtime/turn-direct.js");
    const result = await turnStreamDirect(sampleDeps(), {
      channel: "ui",
      thread_id: "thread-1",
      message: "hello",
    } as never);

    await expect(result.finalize()).rejects.toThrow(/maximum context length/);
    expect(compactForOverflowMock).toHaveBeenCalledOnce();
    expect(finalizeTurnMock).not.toHaveBeenCalled();
  });
});
