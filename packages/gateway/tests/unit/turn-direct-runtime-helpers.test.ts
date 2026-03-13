import { beforeEach, describe, expect, it, vi } from "vitest";

const compactSessionWithResolvedModelMock = vi.hoisted(() => vi.fn());
const shouldCompactSessionForUsageMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("../../src/modules/agent/runtime/session-compaction-service.js", () => ({
  compactSessionWithResolvedModel: compactSessionWithResolvedModelMock,
  shouldCompactSessionForUsage: shouldCompactSessionForUsageMock,
}));

describe("maybeAutoCompactSession", () => {
  beforeEach(() => {
    compactSessionWithResolvedModelMock.mockReset();
    shouldCompactSessionForUsageMock.mockReset();
    shouldCompactSessionForUsageMock.mockReturnValue(true);
  });

  it("still evaluates positive max_turns fallback when usage is missing", async () => {
    const session = {
      tenant_id: "tenant-1",
      session_id: "session-1",
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
    const sessionDal = {
      getById: vi.fn(async () => session),
    };

    const { maybeAutoCompactSession } =
      await import("../../src/modules/agent/runtime/turn-direct-runtime-helpers.js");

    await maybeAutoCompactSession({
      deps: {
        sessionDal: sessionDal as never,
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
          sessions: {
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
      sessionId: "session-1",
      model: {} as never,
      modelResolution: { candidates: [] } as never,
      usage: undefined,
      timeoutMs: 1,
    });

    expect(sessionDal.getById).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      sessionId: "session-1",
    });
    expect(shouldCompactSessionForUsageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session,
        usage: undefined,
      }),
    );
    expect(compactSessionWithResolvedModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session,
        timeoutMs: 1,
      }),
    );
  });
});
