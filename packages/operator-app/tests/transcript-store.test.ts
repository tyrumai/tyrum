import { describe, expect, it, vi } from "vitest";
import { createTranscriptStore } from "../src/stores/transcript-store.js";

function createConversationSummary(overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: "conversation-root-id",
    conversation_key: "conversation-root",
    agent_key: "default",
    channel: "ui",
    thread_id: "thread-root",
    title: "Root conversation",
    message_count: 2,
    updated_at: "2026-03-13T12:00:00.000Z",
    created_at: "2026-03-13T11:00:00.000Z",
    archived: false,
    latest_turn_id: null,
    latest_turn_status: null,
    has_active_turn: false,
    pending_approval_count: 0,
    ...overrides,
  };
}

function createTranscriptListResult(overrides: Record<string, unknown> = {}) {
  return {
    conversations: [
      createConversationSummary({
        child_conversations: [
          createConversationSummary({
            conversation_id: "conversation-child-id",
            conversation_key: "conversation-child",
            thread_id: "thread-child",
            title: "Child conversation",
            parent_conversation_key: "conversation-root",
            subagent_id: "subagent-1",
            latest_turn_id: "run-1",
            latest_turn_status: "running",
            has_active_turn: true,
            pending_approval_count: 1,
          }),
        ],
      }),
    ],
    next_cursor: "cursor-1",
    ...overrides,
  };
}

function createTranscriptGetResult(overrides: Record<string, unknown> = {}) {
  return {
    root_conversation_key: "conversation-root",
    focus_conversation_key: "conversation-child",
    conversations: [
      createConversationSummary(),
      createConversationSummary({
        conversation_id: "conversation-child-id",
        conversation_key: "conversation-child",
        thread_id: "thread-child",
        title: "Child conversation",
        parent_conversation_key: "conversation-root",
        subagent_id: "subagent-1",
      }),
    ],
    events: [
      {
        event_id: "message:conversation-child:msg-1",
        kind: "message",
        occurred_at: "2026-03-13T12:01:00.000Z",
        conversation_key: "conversation-child",
        payload: {
          message: {
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "inspect transcript" }],
          },
        },
      },
    ],
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve = (_value: T) => {
    throw new Error("deferred promise resolved before initialization");
  };
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createFakeWs() {
  const api = {
    requestDynamic: vi.fn(
      async (
        type: string,
        payload: unknown,
        schema?: { parse?: (input: unknown) => unknown },
      ): Promise<unknown> => {
        let result: unknown;
        switch (type) {
          case "transcript.list":
            result = await api.transcriptList(payload);
            break;
          case "transcript.get":
            result = await api.transcriptGet(payload);
            break;
          default:
            throw new Error(`unsupported dynamic request: ${type}`);
        }
        return schema?.parse ? schema.parse(result) : result;
      },
    ),
    transcriptList: vi.fn(async () => createTranscriptListResult()),
    transcriptGet: vi.fn(async () => createTranscriptGetResult()),
  };
  return api;
}

describe("createTranscriptStore", () => {
  it("refreshes transcripts, normalizes filters, and flattens child conversations", async () => {
    const ws = createFakeWs();
    const transcript = createTranscriptStore(ws as never);

    transcript.setAgentKey(" default ");
    transcript.setChannel(" ui ");
    transcript.setActiveOnly(true);

    await transcript.refresh();

    expect(ws.requestDynamic).toHaveBeenCalledWith(
      "transcript.list",
      {
        agent_key: "default",
        channel: "ui",
        active_only: true,
        limit: 200,
      },
      expect.anything(),
    );

    const snapshot = transcript.getSnapshot();
    expect(snapshot.conversations.map((conversation) => conversation.conversation_key)).toEqual([
      "conversation-root",
      "conversation-child",
    ]);
    expect(snapshot.selectedConversationKey).toBe("conversation-root");
    expect(snapshot.nextCursor).toBe("cursor-1");
    expect(snapshot.errorList).toBeNull();
  });

  it("loads more transcript roots and merges duplicate conversation keys", async () => {
    const ws = createFakeWs();
    ws.transcriptList.mockResolvedValueOnce(createTranscriptListResult()).mockResolvedValueOnce({
      conversations: [
        createConversationSummary({ title: "Root conversation updated" }),
        createConversationSummary({
          conversation_id: "conversation-extra-id",
          conversation_key: "conversation-extra",
          thread_id: "thread-extra",
          title: "Extra conversation",
        }),
      ],
      next_cursor: null,
    });
    const transcript = createTranscriptStore(ws as never);

    await transcript.refresh();
    await transcript.loadMore();

    expect(ws.requestDynamic).toHaveBeenNthCalledWith(
      2,
      "transcript.list",
      { limit: 200, cursor: "cursor-1" },
      expect.anything(),
    );
    const snapshot = transcript.getSnapshot();
    expect(snapshot.conversations.map((conversation) => conversation.conversation_key)).toEqual([
      "conversation-root",
      "conversation-child",
      "conversation-extra",
    ]);
    expect(
      snapshot.conversations.find(
        (conversation) => conversation.conversation_key === "conversation-root",
      )?.title,
    ).toBe("Root conversation updated");
    expect(snapshot.nextCursor).toBeNull();
  });

  it("clears list state and ignores stale loadMore results when filters change", async () => {
    const ws = createFakeWs();
    const deferred = createDeferred<ReturnType<typeof createTranscriptListResult>>();
    ws.transcriptList
      .mockResolvedValueOnce(createTranscriptListResult())
      .mockReturnValueOnce(deferred.promise);
    const transcript = createTranscriptStore(ws as never);

    await transcript.refresh();

    const loadMorePromise = transcript.loadMore();
    expect(transcript.getSnapshot()).toMatchObject({
      conversations: expect.arrayContaining([
        expect.objectContaining({ conversation_key: "conversation-root" }),
      ]),
      nextCursor: "cursor-1",
      loadingList: true,
    });

    transcript.setChannel(" other ");

    expect(transcript.getSnapshot()).toMatchObject({
      channel: "other",
      conversations: [],
      nextCursor: null,
      loadingList: false,
      errorList: null,
      selectedConversationKey: null,
      detail: null,
    });

    deferred.resolve({
      conversations: [
        createConversationSummary({
          conversation_id: "conversation-extra-id",
          conversation_key: "conversation-extra",
          thread_id: "thread-extra",
          title: "Extra conversation",
        }),
      ],
      next_cursor: null,
    });
    await loadMorePromise;

    expect(transcript.getSnapshot()).toMatchObject({
      channel: "other",
      conversations: [],
      nextCursor: null,
      loadingList: false,
      errorList: null,
    });
  });

  it("opens a transcript detail view and clears it when filters change", async () => {
    const ws = createFakeWs();
    const transcript = createTranscriptStore(ws as never);

    await transcript.openConversation(" conversation-child ");

    expect(ws.requestDynamic).toHaveBeenCalledWith(
      "transcript.get",
      { conversation_key: "conversation-child" },
      expect.anything(),
    );
    expect(transcript.getSnapshot().detail).toEqual({
      rootConversationKey: "conversation-root",
      focusConversationKey: "conversation-child",
      conversations: createTranscriptGetResult().conversations,
      events: createTranscriptGetResult().events,
    });

    transcript.setArchived(true);
    expect(transcript.getSnapshot().detail).toBeNull();
    expect(transcript.getSnapshot().selectedConversationKey).toBeNull();

    transcript.clearDetail();
    expect(transcript.getSnapshot().detail).toBeNull();
  });

  it("cancels a stale transcript detail load when filters change", async () => {
    const ws = createFakeWs();
    const deferred = createDeferred<ReturnType<typeof createTranscriptGetResult>>();
    ws.transcriptGet.mockReturnValueOnce(deferred.promise);
    const transcript = createTranscriptStore(ws as never);

    const openConversationPromise = transcript.openConversation(" conversation-child ");
    expect(transcript.getSnapshot()).toMatchObject({
      selectedConversationKey: "conversation-child",
      loadingDetail: true,
      detail: null,
      errorDetail: null,
    });

    transcript.setArchived(true);
    expect(transcript.getSnapshot()).toMatchObject({
      selectedConversationKey: null,
      loadingDetail: false,
      detail: null,
      errorDetail: null,
    });

    deferred.resolve(createTranscriptGetResult());
    await openConversationPromise;

    expect(transcript.getSnapshot()).toMatchObject({
      selectedConversationKey: null,
      loadingDetail: false,
      detail: null,
      errorDetail: null,
    });
  });

  it("stores transcript list and detail errors when requests fail", async () => {
    const ws = createFakeWs();
    ws.transcriptList.mockRejectedValueOnce(new Error("transcript.list failed: denied: nope"));
    ws.transcriptGet.mockRejectedValueOnce(new Error("transcript.get timed out"));
    const transcript = createTranscriptStore(ws as never);

    await transcript.refresh();
    await transcript.openConversation("conversation-root");

    expect(transcript.getSnapshot().errorList).toEqual({
      kind: "ws",
      operation: "transcript.list",
      code: "denied",
      message: "nope",
    });
    expect(transcript.getSnapshot().errorDetail).toEqual({
      kind: "ws",
      operation: "transcript.get",
      code: "timeout",
      message: "timed out",
    });
  });

  it("clears stale detail before loading a different transcript conversation", async () => {
    const ws = createFakeWs();
    const deferred = createDeferred<ReturnType<typeof createTranscriptGetResult>>();
    const transcript = createTranscriptStore(ws as never);

    await transcript.openConversation("conversation-child");
    ws.transcriptGet.mockReturnValueOnce(deferred.promise);

    const openConversationPromise = transcript.openConversation("conversation-root");

    expect(transcript.getSnapshot()).toMatchObject({
      selectedConversationKey: "conversation-root",
      loadingDetail: true,
      detail: null,
      errorDetail: null,
    });

    deferred.resolve(createTranscriptGetResult({ focus_conversation_key: "conversation-root" }));
    await openConversationPromise;

    expect(transcript.getSnapshot().detail).toMatchObject({
      focusConversationKey: "conversation-root",
    });
  });

  it("does not keep previous detail when loading a different transcript conversation fails", async () => {
    const ws = createFakeWs();
    const transcript = createTranscriptStore(ws as never);

    await transcript.openConversation("conversation-child");
    ws.transcriptGet.mockRejectedValueOnce(new Error("transcript.get timed out"));

    await transcript.openConversation("conversation-root");

    expect(transcript.getSnapshot()).toMatchObject({
      selectedConversationKey: "conversation-root",
      detail: null,
      errorDetail: {
        kind: "ws",
        operation: "transcript.get",
        code: "timeout",
        message: "timed out",
      },
    });
  });

  it("keeps existing conversations when loadMore fails", async () => {
    const ws = createFakeWs();
    ws.transcriptList
      .mockResolvedValueOnce(createTranscriptListResult())
      .mockRejectedValueOnce(new Error("transcript.list failed: unavailable: later"));
    const transcript = createTranscriptStore(ws as never);

    await transcript.refresh();
    await transcript.loadMore();

    expect(
      transcript.getSnapshot().conversations.map((conversation) => conversation.conversation_key),
    ).toEqual(["conversation-root", "conversation-child"]);
    expect(transcript.getSnapshot().errorList).toEqual({
      kind: "ws",
      operation: "transcript.list",
      code: "unavailable",
      message: "later",
    });
  });

  it("clears stale detail when refresh no longer includes the selected conversation", async () => {
    const ws = createFakeWs();
    ws.transcriptList.mockResolvedValueOnce(createTranscriptListResult()).mockResolvedValueOnce({
      conversations: [
        createConversationSummary({
          conversation_id: "conversation-next-id",
          conversation_key: "conversation-next",
          thread_id: "thread-next",
          title: "Next conversation",
        }),
      ],
      next_cursor: null,
    });
    const transcript = createTranscriptStore(ws as never);

    await transcript.refresh();
    await transcript.openConversation("conversation-child");
    await transcript.refresh();

    expect(transcript.getSnapshot().selectedConversationKey).toBe("conversation-next");
    expect(transcript.getSnapshot().detail).toBeNull();
    expect(transcript.getSnapshot().errorDetail).toBeNull();
  });

  it("ignores blank conversation opens and loadMore without a cursor", async () => {
    const ws = createFakeWs();
    const transcript = createTranscriptStore(ws as never);

    await transcript.openConversation("   ");
    await transcript.loadMore();

    expect(ws.requestDynamic).not.toHaveBeenCalled();
    expect(transcript.getSnapshot()).toMatchObject({
      conversations: [],
      selectedConversationKey: null,
      detail: null,
      loadingList: false,
      loadingDetail: false,
    });
  });
});
