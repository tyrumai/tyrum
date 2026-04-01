import { beforeEach, describe, expect, it, vi } from "vitest";

const generateTextMock = vi.hoisted(() => vi.fn());
const streamTextMock = vi.hoisted(() => vi.fn());
const prepareTurnMock = vi.hoisted(() => vi.fn());
const finalizeTurnMock = vi.hoisted(() => vi.fn());
const compactForOverflowMock = vi.hoisted(() => vi.fn());
const maybeAutoCompactConversationMock = vi.hoisted(() => vi.fn());
const extractToolApprovalResumeStateMock = vi.hoisted(() => vi.fn(() => undefined));
const appendToolApprovalResponseMessageMock = vi.hoisted(() =>
  vi.fn((messages: unknown) => messages),
);
const applyDeterministicContextCompactionAndToolPruningMock = vi.hoisted(() =>
  vi.fn((messages: unknown) => messages),
);
const conversationMessagesToModelMessagesMock = vi.hoisted(() => vi.fn(async () => []));
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
  maybeAutoCompactConversation: maybeAutoCompactConversationMock,
  prepareConversationQueueStep: vi.fn(() => ({ messages: [] })),
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

vi.mock("../../src/modules/agent/runtime/execution-profile-resolution.js", () => ({
  delegateFromIntake: vi.fn(),
  handleIntakeModeDecision: vi.fn(async () => null),
  resolveIntakeDecision: vi.fn(async () => ({ mode: "continue" })),
}));

vi.mock("../../src/modules/agent/runtime/automation-delivery.js", () => ({
  resolveAutomationMetadata: vi.fn(() => null),
}));

vi.mock("../../src/modules/ai-sdk/message-utils.js", () => ({
  appendToolApprovalResponseMessage: appendToolApprovalResponseMessageMock,
  countAssistantMessages: vi.fn(() => 0),
  conversationMessagesToModelMessages: conversationMessagesToModelMessagesMock,
}));

vi.mock("../../src/modules/agent/runtime/context-pruning.js", () => ({
  applyDeterministicContextCompactionAndToolPruning:
    applyDeterministicContextCompactionAndToolPruningMock,
}));

vi.mock("../../src/modules/agent/runtime/conversation-context-state.js", () => ({
  buildPromptVisibleMessages: buildPromptVisibleMessagesMock,
}));

vi.mock("../../src/modules/agent/runtime/conversation-compaction-service.js", () => ({
  isContextOverflowError: vi.fn(
    (error: unknown) => error instanceof Error && error.message.includes("maximum context length"),
  ),
}));

function samplePreparedTurn(usedTools: Set<string>) {
  return {
    ctx: {
      config: {
        conversations: {
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
    conversation: {
      tenant_id: "tenant-1",
      conversation_id: "conversation-1",
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
    mainConversationKey: "agent:default:ui:main",
    model: {},
    modelResolution: { candidates: [] },
    toolSet: {},
    toolCallPolicyStates: new Map(),
    queueState: undefined,
    usedTools,
    memoryWriteState: { wrote: false },
    userContent: [{ type: "text", text: "hello" }],
    rewriteHistoryAttachmentsForModel: false,
    contextReport: {
      conversation_id: "conversation-1",
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
    conversationDal: {
      getById: vi.fn(async () => ({
        tenant_id: "tenant-1",
        conversation_id: "conversation-1",
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
    maybeAutoCompactConversationMock.mockReset();
    extractToolApprovalResumeStateMock.mockReset();
    extractToolApprovalResumeStateMock.mockReturnValue(undefined);
    conversationMessagesToModelMessagesMock.mockReset();
    conversationMessagesToModelMessagesMock.mockResolvedValue([]);
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

  it("strips embedded conversation context when checkpoint state is injected separately", async () => {
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
        { type: "text", text: "Conversation state:\nstale checkpoint text" },
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
    deps.conversationDal.getById = vi.fn(async () => ({
      tenant_id: "tenant-1",
      conversation_id: "conversation-1",
      agent_id: "agent-1",
      workspace_id: "workspace-1",
      messages: [],
      context_state: refreshedContextState,
    }));

    const { turnDirect } = await import("../../src/modules/agent/runtime/turn-direct.js");

    await turnDirect(deps, { channel: "ui", thread_id: "thread-1", message: "hello" } as never);

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
    deps.conversationDal.getById = vi.fn(async () => ({
      tenant_id: "tenant-1",
      conversation_id: "conversation-1",
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

    await turnDirect(deps, { channel: "ui", thread_id: "thread-1", message: "hello" } as never);

    expect(conversationMessagesToModelMessagesMock).toHaveBeenCalledWith([
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
    maybeAutoCompactConversationMock.mockReset();
    extractToolApprovalResumeStateMock.mockReset();
    appendToolApprovalResponseMessageMock.mockReset();
    appendToolApprovalResponseMessageMock.mockImplementation((messages: unknown) => messages);
    applyDeterministicContextCompactionAndToolPruningMock.mockReset();
    applyDeterministicContextCompactionAndToolPruningMock.mockImplementation(
      (messages: unknown) => messages,
    );
    conversationMessagesToModelMessagesMock.mockReset();
    conversationMessagesToModelMessagesMock.mockResolvedValue([]);
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

  it("prunes approval resume messages after appending the approval response", async () => {
    prepareTurnMock.mockResolvedValue(samplePreparedTurn(new Set()));
    const resumeMessages = [
      {
        role: "assistant" as const,
        content: [{ type: "text", text: "resume assistant" }],
      },
    ];
    const resumedWithApproval = [
      ...resumeMessages,
      {
        role: "tool" as const,
        content: [{ type: "tool-approval-response", approvalId: "approval-1", approved: true }],
      },
    ];
    extractToolApprovalResumeStateMock.mockReturnValue({
      approval_id: "approval-1",
      messages: resumeMessages,
      memory_written: false,
      used_tools: [],
      steps_used: 0,
    });
    appendToolApprovalResponseMessageMock.mockReturnValue(resumedWithApproval);
    applyDeterministicContextCompactionAndToolPruningMock.mockReturnValue(resumedWithApproval);
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

    expect(appendToolApprovalResponseMessageMock).toHaveBeenCalledWith(resumeMessages, {
      approvalId: "approval-1",
      approved: true,
      reason: undefined,
    });
    expect(applyDeterministicContextCompactionAndToolPruningMock).toHaveBeenCalledWith(
      resumedWithApproval,
      {},
    );
    expect(conversationMessagesToModelMessagesMock).not.toHaveBeenCalled();
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: resumedWithApproval,
      }),
    );
  });
});

describe("turnStreamDirect overflow handling", () => {
  beforeEach(() => {
    streamTextMock.mockReset();
    prepareTurnMock.mockReset();
    finalizeTurnMock.mockReset();
    compactForOverflowMock.mockReset();
    maybeAutoCompactConversationMock.mockReset();
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

  it("forwards execution turnId into streamed finalization", async () => {
    prepareTurnMock.mockResolvedValue(samplePreparedTurn(new Set()));
    streamTextMock.mockReturnValue({
      response: Promise.resolve({ messages: [] }),
      steps: Promise.resolve([]),
      text: Promise.resolve("ok"),
    });
    finalizeTurnMock.mockResolvedValue({ reply: "ok" });

    const { turnStreamDirect } = await import("../../src/modules/agent/runtime/turn-direct.js");
    const result = await turnStreamDirect(
      sampleDeps(),
      { channel: "ui", thread_id: "thread-1", message: "hello" } as never,
      { execution: { planId: "plan-1", turnId: "turn-1", stepIndex: 0, stepId: "step-1" } },
    );

    await result.finalize();

    expect(finalizeTurnMock).toHaveBeenCalledWith(expect.objectContaining({ turn_id: "turn-1" }));
  });
});
