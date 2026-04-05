import { describe, expect, it } from "vitest";
import { createTranscriptStore } from "../src/stores/transcript-store.js";
import {
  createConversationSummary,
  createDeferred,
  createFakeWs,
  createTranscriptGetResult,
  createTranscriptListResult,
} from "./transcript-store.test-support.js";

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

  it("merges live turn updates and turn items into the open transcript detail", async () => {
    const ws = createFakeWs();
    const turnId = "11111111-2222-4333-8444-555555555555";
    const turnConversationKey = "agent:default:ui:default:channel:thread-child";
    ws.transcriptGet.mockResolvedValueOnce(
      createTranscriptGetResult({
        focus_conversation_key: "conversation-child",
        events: [
          {
            event_id: `turn:${turnId}`,
            kind: "turn",
            occurred_at: "2026-03-13T12:01:00.000Z",
            conversation_key: "conversation-child",
            parent_conversation_key: "conversation-root",
            subagent_id: "subagent-1",
            payload: {
              turn: {
                turn_id: turnId,
                job_id: "11111111-2222-4333-8444-666666666666",
                conversation_key: turnConversationKey,
                status: "running",
                attempt: 1,
                created_at: "2026-03-13T12:01:00.000Z",
                started_at: "2026-03-13T12:01:01.000Z",
                finished_at: null,
              },
              turn_items: [],
            },
          },
        ],
      }),
    );
    const transcript = createTranscriptStore(ws as never);

    await transcript.openConversation("conversation-child");

    transcript.handleTurnUpdated({
      turn_id: turnId,
      job_id: "11111111-2222-4333-8444-666666666666",
      conversation_key: turnConversationKey,
      status: "succeeded",
      attempt: 1,
      created_at: "2026-03-13T12:01:00.000Z",
      started_at: "2026-03-13T12:01:01.000Z",
      finished_at: "2026-03-13T12:02:00.000Z",
    });
    transcript.handleTurnItemCreated({
      turn_item_id: "11111111-2222-4333-8444-777777777777",
      turn_id: turnId,
      item_index: 0,
      item_key: "message:assistant-1",
      kind: "message",
      created_at: "2026-03-13T12:02:00.000Z",
      payload: {
        message: {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "Turn item arrived." }],
          metadata: { turn_id: turnId, created_at: "2026-03-13T12:02:00.000Z" },
        },
      },
    });

    const detail = transcript.getSnapshot().detail;
    const turnEvent = detail?.events.find((event) => event.kind === "turn");
    const messageEvent = detail?.events.find((event) => event.kind === "message");

    expect(turnEvent).toMatchObject({
      payload: {
        turn: expect.objectContaining({
          turn_id: turnId,
          status: "succeeded",
          finished_at: "2026-03-13T12:02:00.000Z",
        }),
        turn_items: [
          expect.objectContaining({
            turn_item_id: "11111111-2222-4333-8444-777777777777",
          }),
        ],
      },
    });
    expect(messageEvent).toMatchObject({
      event_id: "message:conversation-child:assistant-1",
      occurred_at: "2026-03-13T12:02:00.000Z",
      conversation_key: "conversation-child",
      payload: {
        message: expect.objectContaining({
          id: "assistant-1",
        }),
      },
    });
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
