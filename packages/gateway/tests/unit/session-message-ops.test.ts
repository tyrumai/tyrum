import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import {
  handleSessionCompactMessage,
  handleSessionSendMessage,
} from "../../src/ws/protocol/session-message-ops.js";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import { enqueueWsBroadcastMessage } from "../../src/ws/outbox.js";
import { makeClient, makeDeps } from "./ws-protocol.test-support.js";

vi.mock("../../src/ws/outbox.js", () => ({
  enqueueWsBroadcastMessage: vi.fn(async () => undefined),
}));

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

  it("streams chat events while sending a session message", async () => {
    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
    const client = cm.getClient(id)!;
    const runtime = {
      turnStream: vi.fn(async () => ({
        sessionId: "internal-session-1",
        streamResult: {
          fullStream: (async function* () {
            yield { type: "reasoning-delta", id: "reason-1", delta: "Think" };
            yield { type: "text-delta", id: "assistant-1", delta: "Hello" };
          })(),
        },
        finalize: vi.fn(async () => ({
          reply: "Hello",
          session_id: "internal-session-1",
          session_key: "session-key-1",
          used_tools: [],
          memory_written: false,
        })),
      })),
    };
    const agents = {
      getRuntime: vi.fn(async () => runtime),
    };

    vi.spyOn(SessionDal.prototype, "getOrCreate").mockResolvedValue({
      session_id: "internal-session-1",
      session_key: "session-key-1",
    } as never);

    const response = await handleSessionSendMessage(
      client,
      {
        request_id: "r-2",
        type: "session.send",
        payload: {
          agent_id: "default",
          channel: "ui",
          thread_id: "ui-session-1",
          content: "hello",
          client_message_id: "user-1",
        },
      } as never,
      makeDeps(cm, { db: {} as never, agents: agents as never }),
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        session_id: "session-key-1",
        assistant_message: "Hello",
      },
    });
    expect(runtime.turnStream).toHaveBeenCalledWith({
      channel: "ui",
      thread_id: "ui-session-1",
      message: "hello",
      metadata: expect.objectContaining({
        source: "ws",
        request_id: "r-2",
        client_message_id: "user-1",
      }),
    });
    expect(enqueueWsBroadcastMessage).toHaveBeenCalled();
  });

  it("emits a cleanup event when a streamed send fails after partial deltas", async () => {
    vi.mocked(enqueueWsBroadcastMessage).mockClear();

    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
    const client = cm.getClient(id)!;
    const runtime = {
      turnStream: vi.fn(async () => ({
        sessionId: "internal-session-1",
        streamResult: {
          fullStream: (async function* () {
            yield { type: "reasoning-delta", id: "reason-1", delta: "Think" };
            yield { type: "text-delta", id: "assistant-1", delta: "Hello" };
            throw new Error("stream failed");
          })(),
        },
        finalize: vi.fn(async () => ({
          reply: "ignored",
          session_id: "internal-session-1",
          session_key: "session-key-1",
          used_tools: [],
          memory_written: false,
        })),
      })),
    };
    const agents = {
      getRuntime: vi.fn(async () => runtime),
    };

    vi.spyOn(SessionDal.prototype, "getOrCreate").mockResolvedValue({
      session_id: "internal-session-1",
      session_key: "session-key-1",
    } as never);

    const response = await handleSessionSendMessage(
      client,
      {
        request_id: "r-3",
        type: "session.send",
        payload: {
          agent_id: "default",
          channel: "ui",
          thread_id: "ui-session-1",
          content: "hello",
          client_message_id: "user-1",
        },
      } as never,
      makeDeps(cm, { db: {} as never, agents: agents as never }),
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "agent_runtime_error",
        message: "stream failed",
      },
    });

    const eventTypes = vi
      .mocked(enqueueWsBroadcastMessage)
      .mock.calls.map(([, , event]) => event.type);
    expect(eventTypes).toEqual([
      "typing.started",
      "message.final",
      "reasoning.delta",
      "message.delta",
      "session.send.failed",
      "typing.stopped",
    ]);
    expect(vi.mocked(enqueueWsBroadcastMessage).mock.calls[4]?.[2]).toMatchObject({
      type: "session.send.failed",
      payload: {
        session_id: "session-key-1",
        thread_id: "ui-session-1",
        user_message_id: "user-1",
        message_ids: ["assistant-1"],
        reasoning_ids: ["reason-1"],
      },
    });
  });

  it("preserves the original stream error when cleanup emits fail", async () => {
    vi.mocked(enqueueWsBroadcastMessage).mockClear();
    vi.mocked(enqueueWsBroadcastMessage).mockImplementation(async (_db, _tenantId, event) => {
      if (event.type === "session.send.failed" || event.type === "typing.stopped") {
        throw new Error(`emit failed for ${event.type}`);
      }
    });

    const cm = new ConnectionManager();
    const { id } = makeClient(cm, ["cli"]);
    const client = cm.getClient(id)!;
    const runtime = {
      turnStream: vi.fn(async () => ({
        sessionId: "internal-session-1",
        streamResult: {
          fullStream: (async function* () {
            yield { type: "text-delta", id: "assistant-1", delta: "Hello" };
            throw new Error("stream failed");
          })(),
        },
        finalize: vi.fn(async () => ({
          reply: "ignored",
          session_id: "internal-session-1",
          session_key: "session-key-1",
          used_tools: [],
          memory_written: false,
        })),
      })),
    };
    const agents = {
      getRuntime: vi.fn(async () => runtime),
    };

    vi.spyOn(SessionDal.prototype, "getOrCreate").mockResolvedValue({
      session_id: "internal-session-1",
      session_key: "session-key-1",
    } as never);

    const response = await handleSessionSendMessage(
      client,
      {
        request_id: "r-4",
        type: "session.send",
        payload: {
          agent_id: "default",
          channel: "ui",
          thread_id: "ui-session-1",
          content: "hello",
          client_message_id: "user-1",
        },
      } as never,
      makeDeps(cm, { db: {} as never, agents: agents as never }),
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "agent_runtime_error",
        message: "stream failed",
      },
    });
    expect(
      vi.mocked(enqueueWsBroadcastMessage).mock.calls.map(([, , event]) => event.type),
    ).toEqual([
      "typing.started",
      "message.final",
      "message.delta",
      "session.send.failed",
      "typing.stopped",
    ]);
  });
});
