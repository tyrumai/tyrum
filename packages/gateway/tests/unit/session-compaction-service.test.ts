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

const mockGenerateText = vi.mocked(generateText);

describe("isContextOverflowError", () => {
  it("matches common model context overflow messages", () => {
    expect(
      isContextOverflowError(new Error("This model's maximum context length is 128000 tokens.")),
    ).toBe(true);
    expect(isContextOverflowError(new Error("Prompt is too large for this model."))).toBe(true);
    expect(isContextOverflowError(new Error("Prompt is too long for this model."))).toBe(true);
    expect(isContextOverflowError(new Error("Message is too long for this model."))).toBe(true);
  });

  it("does not treat unrelated too-large errors as context overflow", () => {
    expect(isContextOverflowError(new Error("413 Payload Too Large"))).toBe(false);
    expect(isContextOverflowError(new Error("request body too large"))).toBe(false);
    expect(isContextOverflowError(new Error("response body too large"))).toBe(false);
    expect(isContextOverflowError(new Error("file too large"))).toBe(false);
  });
});

describe("shouldCompactSessionForUsage", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it("does not fall back to turn-count compaction when max_turns is disabled", () => {
    expect(
      shouldCompactSessionForUsage({
        config: {
          sessions: { max_turns: 0, compaction: { auto: true, reserved_input_tokens: 20_000 } },
        } as never,
        session: {
          transcript: [
            {
              kind: "text",
              id: "turn-1",
              role: "user",
              content: "m1",
              created_at: "2026-03-08T00:00:00Z",
            },
            {
              kind: "text",
              id: "turn-2",
              role: "assistant",
              content: "r1",
              created_at: "2026-03-08T00:00:00Z",
            },
          ],
        } as never,
        modelResolution: { candidates: [] } as never,
        usage: { inputTokens: 999_999 },
      }),
    ).toBe(false);
  });

  it("uses deprecated max_turns fallback only when configured to a positive value", () => {
    expect(
      shouldCompactSessionForUsage({
        config: {
          sessions: { max_turns: 2, compaction: { auto: true, reserved_input_tokens: 20_000 } },
        } as never,
        session: {
          transcript: [
            {
              kind: "text",
              id: "turn-1",
              role: "user",
              content: "m1",
              created_at: "2026-03-08T00:00:00Z",
            },
            {
              kind: "text",
              id: "turn-2",
              role: "assistant",
              content: "r1",
              created_at: "2026-03-08T00:00:00Z",
            },
            {
              kind: "text",
              id: "turn-3",
              role: "user",
              content: "m2",
              created_at: "2026-03-08T00:00:01Z",
            },
            {
              kind: "text",
              id: "turn-4",
              role: "assistant",
              content: "r2",
              created_at: "2026-03-08T00:00:01Z",
            },
          ],
        } as never,
        modelResolution: { candidates: [] } as never,
        usage: undefined,
      }),
    ).toBe(true);
  });

  it("falls back deterministically when the timeout slice is too small", async () => {
    const sessionDal = {
      compact: vi.fn(async () => ({ droppedMessages: 4, keptMessages: 0 })),
      getById: vi.fn(async () => ({ summary: "fallback summary" })),
    };

    const result = await compactSessionWithResolvedModel({
      container: {
        db: {},
        logger: { warn: vi.fn() },
      } as never,
      sessionDal: sessionDal as never,
      ctx: {
        config: {
          sessions: {
            compaction: {
              keep_last_messages_after_compaction: 0,
            },
          },
          memory: { v1: { enabled: false } },
        },
      } as never,
      session: {
        tenant_id: "tenant-1",
        session_id: "session-1",
        agent_id: "agent-1",
        summary: "existing summary",
        transcript: [
          {
            kind: "text",
            id: "turn-1",
            role: "user",
            content: "u1",
            created_at: "2026-03-08T00:00:00Z",
          },
          {
            kind: "text",
            id: "turn-2",
            role: "assistant",
            content: "a1",
            created_at: "2026-03-08T00:00:00Z",
          },
          {
            kind: "text",
            id: "turn-3",
            role: "user",
            content: "u2",
            created_at: "2026-03-08T00:00:01Z",
          },
          {
            kind: "text",
            id: "turn-4",
            role: "assistant",
            content: "a2",
            created_at: "2026-03-08T00:00:01Z",
          },
        ],
      } as never,
      model: {} as never,
      keepLastMessages: 0,
      timeoutMs: 1,
      logger: { warn: vi.fn() },
    });

    expect(sessionDal.compact).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      sessionId: "session-1",
      keepLastMessages: 0,
    });
    expect(result).toEqual({
      compacted: true,
      droppedMessages: 4,
      keptMessages: 0,
      summary: "fallback summary",
      reason: "fallback",
    });
  });

  it("preserves all non-text transcript items and the existing title on model compaction", async () => {
    mockGenerateText.mockResolvedValue({ text: "compacted summary" } as never);
    const replaceTranscript = vi.fn(async () => undefined);

    const result = await compactSessionWithResolvedModel({
      container: {
        db: {},
        logger: { warn: vi.fn() },
      } as never,
      sessionDal: {
        replaceTranscript,
      } as never,
      ctx: {
        config: {
          sessions: {
            compaction: {
              keep_last_messages_after_compaction: 2,
            },
          },
          memory: { v1: { enabled: false } },
        },
      } as never,
      session: {
        tenant_id: "tenant-1",
        session_id: "session-1",
        agent_id: "agent-1",
        title: "Named thread",
        summary: "existing summary",
        transcript: [
          {
            kind: "text",
            id: "turn-1",
            role: "user",
            content: "u1",
            created_at: "2026-03-08T00:00:00Z",
          },
          {
            kind: "tool",
            id: "tool-1",
            tool_id: "webfetch",
            tool_call_id: "call-1",
            status: "completed",
            summary: "Fetched page",
            created_at: "2026-03-08T00:00:00Z",
            updated_at: "2026-03-08T00:00:01Z",
            channel: "ui",
            thread_id: "thread-1",
            agent_id: "agent-1",
            workspace_id: "workspace-1",
          },
          {
            kind: "text",
            id: "turn-2",
            role: "assistant",
            content: "a1",
            created_at: "2026-03-08T00:00:02Z",
          },
          {
            kind: "approval",
            id: "approval-1",
            approval_id: "approval-1",
            status: "pending",
            title: "Approval required",
            detail: "Need approval",
            created_at: "2026-03-08T00:00:03Z",
            updated_at: "2026-03-08T00:00:03Z",
          },
          {
            kind: "text",
            id: "turn-3",
            role: "user",
            content: "u2",
            created_at: "2026-03-08T00:00:04Z",
          },
        ],
      } as never,
      model: {} as never,
      keepLastMessages: 2,
      logger: { warn: vi.fn() },
    });

    expect(replaceTranscript).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      sessionId: "session-1",
      transcript: [
        expect.objectContaining({ id: "tool-1", kind: "tool" }),
        expect.objectContaining({ id: "turn-2", kind: "text" }),
        expect.objectContaining({ id: "approval-1", kind: "approval" }),
        expect.objectContaining({ id: "turn-3", kind: "text" }),
      ],
      title: "Named thread",
      summary: "compacted summary",
    });
    expect(result).toEqual({
      compacted: true,
      droppedMessages: 1,
      keptMessages: 2,
      summary: "compacted summary",
      reason: "model",
    });
  });
});
