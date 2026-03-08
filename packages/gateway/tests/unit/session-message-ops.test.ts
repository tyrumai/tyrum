import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { handleSessionCompactMessage } from "../../src/ws/protocol/session-message-ops.js";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import { makeClient, makeDeps } from "./ws-protocol.test-support.js";

describe("handleSessionCompactMessage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards keep_last_messages to runtime compaction", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
    const client = cm.getClient(id)!;
    const runtime = {
      compactSession: vi.fn(async () => ({
        compacted: true,
        droppedMessages: 3,
        keptMessages: 5,
        summary: "summary",
        reason: "model" as const,
      })),
    };
    const agents = {
      getRuntime: vi.fn(async () => runtime),
    };

    vi.spyOn(SessionDal.prototype, "getWithDeliveryByKey").mockResolvedValue({
      session: { session_id: "session-1" },
      agent_key: "default",
    } as never);

    const response = await handleSessionCompactMessage(
      client,
      {
        request_id: "r-1",
        type: "session.compact",
        payload: {
          agent_id: "default",
          session_id: "session-key-1",
          keep_last_messages: 5,
        },
      } as never,
      makeDeps(cm, { db: {} as never, agents: agents as never }),
    );

    expect(agents.getRuntime).toHaveBeenCalledWith({
      tenantId: client.auth_claims!.tenant_id,
      agentKey: "default",
    });
    expect(runtime.compactSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      keepLastMessages: 5,
    });
    expect(response).toMatchObject({
      ok: true,
      result: {
        session_id: "session-key-1",
        dropped_messages: 3,
        kept_messages: 5,
      },
    });
  });
});
