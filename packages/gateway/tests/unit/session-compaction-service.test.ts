import { generateText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  compactSessionWithResolvedModel,
  isContextOverflowError,
  shouldCompactSessionForUsage,
} from "../../src/modules/agent/runtime/session-compaction-service.js";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
    stepCountIs: vi.fn(() => Symbol("step-count")),
  };
});

vi.mock("../../src/modules/agent/runtime/pre-compaction-memory-flush.js", () => ({
  maybeRunPreCompactionMemoryFlush: vi.fn(async () => undefined),
}));

const mockGenerateText = vi.mocked(generateText);

function sampleMessage(id: string, role: "user" | "assistant", text: string) {
  return { id, role, parts: [{ type: "text" as const, text }] };
}

describe("isContextOverflowError", () => {
  it("matches common model context overflow messages", () => {
    expect(
      isContextOverflowError(new Error("This model's maximum context length is 128000 tokens.")),
    ).toBe(true);
    expect(isContextOverflowError(new Error("Prompt is too large for this model."))).toBe(true);
  });
});

describe("shouldCompactSessionForUsage", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("respects compaction.auto=false", () => {
    expect(
      shouldCompactSessionForUsage({
        config: {
          sessions: { max_turns: 2, compaction: { auto: false, reserved_input_tokens: 20_000 } },
        } as never,
        session: {
          messages: [sampleMessage("m1", "user", "hello"), sampleMessage("m2", "assistant", "hi")],
          context_state: {
            version: 1,
            recent_message_ids: [],
            checkpoint: null,
            pending_approvals: [],
            pending_tool_state: [],
            updated_at: "2026-03-08T00:00:00Z",
          },
        } as never,
        modelResolution: { candidates: [] } as never,
        usage: { inputTokens: 999_999 },
      }),
    ).toBe(false);
  });

  it("falls back to max_turns only when enabled", () => {
    expect(
      shouldCompactSessionForUsage({
        config: {
          sessions: { max_turns: 2, compaction: { auto: true, reserved_input_tokens: 20_000 } },
        } as never,
        session: {
          messages: [
            sampleMessage("m1", "user", "hello"),
            sampleMessage("m2", "assistant", "hi"),
            sampleMessage("m3", "user", "again"),
            sampleMessage("m4", "assistant", "done"),
          ],
          context_state: {
            version: 1,
            recent_message_ids: [],
            checkpoint: null,
            pending_approvals: [],
            pending_tool_state: [],
            updated_at: "2026-03-08T00:00:00Z",
          },
        } as never,
        modelResolution: { candidates: [] } as never,
        usage: undefined,
      }),
    ).toBe(true);
  });

  it("retries when the first checkpoint drops a critical identifier", async () => {
    mockGenerateText
      .mockResolvedValueOnce({
        text: JSON.stringify({
          goal: "",
          user_constraints: [],
          decisions: [],
          discoveries: [],
          completed_work: [],
          pending_work: [],
          unresolved_questions: [],
          critical_identifiers: [],
          relevant_files: [],
          handoff_md: "",
        }),
      } as never)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          goal: "continue task",
          user_constraints: [],
          decisions: [],
          discoveries: [],
          completed_work: [],
          pending_work: ["continue the task"],
          unresolved_questions: [],
          critical_identifiers: [],
          relevant_files: [],
          handoff_md: "Continue the task.",
        }),
      } as never);

    const replaceContextState = vi.fn(async () => undefined);
    const result = await compactSessionWithResolvedModel({
      container: { db: {}, logger: { warn: vi.fn() } } as never,
      sessionDal: { replaceContextState } as never,
      ctx: {
        config: {
          sessions: { compaction: { keep_last_messages_after_compaction: 1 } },
          memory: { v1: { enabled: false } },
        },
      } as never,
      session: {
        tenant_id: "tenant-1",
        session_id: "session-1",
        agent_id: "agent-1",
        title: "",
        messages: [
          sampleMessage("m1", "user", "Continue the task from the earlier messages."),
          sampleMessage("m2", "assistant", "I will inspect it."),
        ],
        context_state: {
          version: 1,
          recent_message_ids: [],
          checkpoint: null,
          pending_approvals: [],
          pending_tool_state: [],
          updated_at: "2026-03-08T00:00:00Z",
        },
      } as never,
      model: {} as never,
      keepLastMessages: 1,
      timeoutMs: 1_000,
      logger: { warn: vi.fn() },
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(result.summary).toContain("Continue the task.");
    expect(replaceContextState).toHaveBeenCalledOnce();
  });

  it("falls back to deterministic checkpointing when model compaction fails", async () => {
    mockGenerateText.mockRejectedValue(new Error("rate limited"));
    const replaceContextState = vi.fn(async () => undefined);
    const logger = { warn: vi.fn() };

    const result = await compactSessionWithResolvedModel({
      container: { db: {}, logger } as never,
      sessionDal: { replaceContextState } as never,
      ctx: {
        config: {
          sessions: { compaction: { keep_last_messages_after_compaction: 1 } },
          memory: { v1: { enabled: false } },
        },
      } as never,
      session: {
        tenant_id: "tenant-1",
        session_id: "session-1",
        agent_id: "agent-1",
        title: "",
        messages: [
          sampleMessage("m1", "user", "Continue the task from src/routes/api.ts using REQUEST_ID."),
          sampleMessage("m2", "assistant", "I inspected src/routes/api.ts and found the handler."),
        ],
        context_state: {
          version: 1,
          recent_message_ids: [],
          checkpoint: null,
          pending_approvals: [],
          pending_tool_state: [],
          updated_at: "2026-03-08T00:00:00Z",
        },
      } as never,
      model: {} as never,
      keepLastMessages: 1,
      timeoutMs: 1_000,
      logger,
    });

    expect(result.reason).toBe("fallback");
    expect(result.summary).toContain("src/routes/api.ts");
    expect(result.summary).toContain("REQUEST_ID");
    expect(replaceContextState).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith("agents.session_compaction_failed", {
      session_id: "session-1",
      error: "rate limited",
    });
  });
});
