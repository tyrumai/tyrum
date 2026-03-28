import { beforeEach, describe, expect, it, vi } from "vitest";

const compactConversationWithResolvedModelMock = vi.hoisted(() => vi.fn());
const shouldCompactConversationForUsageMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("../../src/modules/agent/runtime/conversation-compaction-service.js", () => ({
  compactConversationWithResolvedModel: compactConversationWithResolvedModelMock,
  shouldCompactConversationForUsage: shouldCompactConversationForUsageMock,
}));

describe("maybeAutoCompactConversation", () => {
  beforeEach(() => {
    compactConversationWithResolvedModelMock.mockReset();
    shouldCompactConversationForUsageMock.mockReset();
    shouldCompactConversationForUsageMock.mockReturnValue(true);
  });

  it("still evaluates positive max_turns fallback when usage is missing", async () => {
    const conversation = {
      tenant_id: "tenant-1",
      conversation_id: "conversation-1",
      agent_id: "agent-1",
      workspace_id: "workspace-1",
      messages: [
        { id: "turn-1", role: "user", parts: [{ type: "text", text: "u1" }] },
        { id: "turn-2", role: "assistant", parts: [{ type: "text", text: "a1" }] },
        { id: "turn-3", role: "user", parts: [{ type: "text", text: "u2" }] },
        { id: "turn-4", role: "assistant", parts: [{ type: "text", text: "a2" }] },
      ],
      context_state: {
        version: 1,
        recent_message_ids: ["turn-1", "turn-2", "turn-3", "turn-4"],
        checkpoint: null,
        pending_approvals: [],
        pending_tool_state: [],
        updated_at: "2026-03-08T00:00:01Z",
      },
    };
    const conversationDal = {
      getById: vi.fn(async () => conversation),
    };

    const { maybeAutoCompactConversation } =
      await import("../../src/modules/agent/runtime/turn-direct-runtime-helpers.js");

    await maybeAutoCompactConversation({
      deps: {
        conversationDal: conversationDal as never,
        opts: {
          container: {
            db: {},
            logger: { warn: vi.fn() },
          },
        },
      } as never,
      tenantId: "tenant-1",
      ctx: {
        config: {
          conversations: {
            max_turns: 2,
            compaction: {
              auto: true,
              keep_last_messages_after_compaction: 0,
              reserved_input_tokens: 20_000,
            },
          },
          mcp: { server_settings: { memory: { enabled: false } } },
        },
      } as never,
      conversationId: "conversation-1",
      model: {} as never,
      modelResolution: { candidates: [] } as never,
      usage: undefined,
      timeoutMs: 1,
    });

    expect(conversationDal.getById).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      conversationId: "conversation-1",
    });
    expect(shouldCompactConversationForUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation,
        usage: undefined,
      }),
    );
    expect(compactConversationWithResolvedModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation,
        timeoutMs: 1,
      }),
    );
  });
});
