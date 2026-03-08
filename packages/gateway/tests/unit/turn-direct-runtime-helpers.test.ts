import { describe, expect, it, vi } from "vitest";
import { maybeAutoCompactSession } from "../../src/modules/agent/runtime/turn-direct-runtime-helpers.js";

describe("maybeAutoCompactSession", () => {
  it("still evaluates positive max_turns fallback when usage is missing", async () => {
    const sessionDal = {
      getById: vi
        .fn()
        .mockResolvedValueOnce({
          tenant_id: "tenant-1",
          session_id: "session-1",
          agent_id: "agent-1",
          summary: "existing summary",
          turns: [
            { role: "user", content: "u1", timestamp: "2026-03-08T00:00:00Z" },
            { role: "assistant", content: "a1", timestamp: "2026-03-08T00:00:00Z" },
            { role: "user", content: "u2", timestamp: "2026-03-08T00:00:01Z" },
            { role: "assistant", content: "a2", timestamp: "2026-03-08T00:00:01Z" },
          ],
        })
        .mockResolvedValueOnce({
          summary: "fallback summary",
        }),
      compact: vi.fn(async () => ({ droppedMessages: 4, keptMessages: 0 })),
    };

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
          memory: { v1: { enabled: false } },
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
    expect(sessionDal.compact).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      sessionId: "session-1",
      keepLastMessages: 0,
    });
  });
});
