import { describe, expect, it, vi } from "vitest";
import { createTranscriptStore } from "../src/stores/transcript-store.js";

function createSessionSummary(overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: "session-root-id",
    conversation_key: "session-root",
    agent_key: "default",
    channel: "ui",
    thread_id: "thread-root",
    title: "Root session",
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
      createSessionSummary({
        child_conversations: [
          createSessionSummary({
            conversation_id: "session-child-id",
            conversation_key: "session-child",
            thread_id: "thread-child",
            title: "Child session",
            parent_conversation_key: "session-root",
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
    root_conversation_key: "session-root",
    focus_conversation_key: "session-child",
    conversations: [
      createSessionSummary(),
      createSessionSummary({
        conversation_id: "session-child-id",
        conversation_key: "session-child",
        thread_id: "thread-child",
        title: "Child session",
        parent_conversation_key: "session-root",
        subagent_id: "subagent-1",
      }),
    ],
    events: [
      {
        event_id: "message:session-child:msg-1",
        kind: "message",
        occurred_at: "2026-03-13T12:01:00.000Z",
        conversation_key: "session-child",
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
  it("refreshes transcripts, normalizes filters, and flattens child sessions", async () => {
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
    expect(snapshot.sessions.map((session) => session.conversation_key)).toEqual([
      "session-root",
      "session-child",
    ]);
    expect(snapshot.selectedSessionKey).toBe("session-root");
    expect(snapshot.nextCursor).toBe("cursor-1");
    expect(snapshot.errorList).toBeNull();
  });

  it("loads more transcript roots and merges duplicate session keys", async () => {
    const ws = createFakeWs();
    ws.transcriptList.mockResolvedValueOnce(createTranscriptListResult()).mockResolvedValueOnce({
      conversations: [
        createSessionSummary({ title: "Root session updated" }),
        createSessionSummary({
          conversation_id: "session-extra-id",
          conversation_key: "session-extra",
          thread_id: "thread-extra",
          title: "Extra session",
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
    expect(snapshot.sessions.map((session) => session.conversation_key)).toEqual([
      "session-root",
      "session-child",
      "session-extra",
    ]);
    expect(
      snapshot.sessions.find((session) => session.conversation_key === "session-root")?.title,
    ).toBe("Root session updated");
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
      sessions: expect.arrayContaining([
        expect.objectContaining({ conversation_key: "session-root" }),
      ]),
      nextCursor: "cursor-1",
      loadingList: true,
    });

    transcript.setChannel(" other ");

    expect(transcript.getSnapshot()).toMatchObject({
      channel: "other",
      sessions: [],
      nextCursor: null,
      loadingList: false,
      errorList: null,
      selectedSessionKey: null,
      detail: null,
    });

    deferred.resolve({
      conversations: [
        createSessionSummary({
          conversation_id: "session-extra-id",
          conversation_key: "session-extra",
          thread_id: "thread-extra",
          title: "Extra session",
        }),
      ],
      next_cursor: null,
    });
    await loadMorePromise;

    expect(transcript.getSnapshot()).toMatchObject({
      channel: "other",
      sessions: [],
      nextCursor: null,
      loadingList: false,
      errorList: null,
    });
  });

  it("opens a transcript detail view and clears it when filters change", async () => {
    const ws = createFakeWs();
    const transcript = createTranscriptStore(ws as never);

    await transcript.openSession(" session-child ");

    expect(ws.requestDynamic).toHaveBeenCalledWith(
      "transcript.get",
      { conversation_key: "session-child" },
      expect.anything(),
    );
    expect(transcript.getSnapshot().detail).toEqual({
      rootSessionKey: "session-root",
      focusSessionKey: "session-child",
      sessions: createTranscriptGetResult().conversations,
      events: createTranscriptGetResult().events,
    });

    transcript.setArchived(true);
    expect(transcript.getSnapshot().detail).toBeNull();
    expect(transcript.getSnapshot().selectedSessionKey).toBeNull();

    transcript.clearDetail();
    expect(transcript.getSnapshot().detail).toBeNull();
  });

  it("cancels a stale transcript detail load when filters change", async () => {
    const ws = createFakeWs();
    const deferred = createDeferred<ReturnType<typeof createTranscriptGetResult>>();
    ws.transcriptGet.mockReturnValueOnce(deferred.promise);
    const transcript = createTranscriptStore(ws as never);

    const openSessionPromise = transcript.openSession(" session-child ");
    expect(transcript.getSnapshot()).toMatchObject({
      selectedSessionKey: "session-child",
      loadingDetail: true,
      detail: null,
      errorDetail: null,
    });

    transcript.setArchived(true);
    expect(transcript.getSnapshot()).toMatchObject({
      selectedSessionKey: null,
      loadingDetail: false,
      detail: null,
      errorDetail: null,
    });

    deferred.resolve(createTranscriptGetResult());
    await openSessionPromise;

    expect(transcript.getSnapshot()).toMatchObject({
      selectedSessionKey: null,
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
    await transcript.openSession("session-root");

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

  it("clears stale detail before loading a different transcript session", async () => {
    const ws = createFakeWs();
    const deferred = createDeferred<ReturnType<typeof createTranscriptGetResult>>();
    const transcript = createTranscriptStore(ws as never);

    await transcript.openSession("session-child");
    ws.transcriptGet.mockReturnValueOnce(deferred.promise);

    const openSessionPromise = transcript.openSession("session-root");

    expect(transcript.getSnapshot()).toMatchObject({
      selectedSessionKey: "session-root",
      loadingDetail: true,
      detail: null,
      errorDetail: null,
    });

    deferred.resolve(createTranscriptGetResult({ focus_conversation_key: "session-root" }));
    await openSessionPromise;

    expect(transcript.getSnapshot().detail).toMatchObject({
      focusSessionKey: "session-root",
    });
  });

  it("does not keep previous detail when loading a different transcript session fails", async () => {
    const ws = createFakeWs();
    const transcript = createTranscriptStore(ws as never);

    await transcript.openSession("session-child");
    ws.transcriptGet.mockRejectedValueOnce(new Error("transcript.get timed out"));

    await transcript.openSession("session-root");

    expect(transcript.getSnapshot()).toMatchObject({
      selectedSessionKey: "session-root",
      detail: null,
      errorDetail: {
        kind: "ws",
        operation: "transcript.get",
        code: "timeout",
        message: "timed out",
      },
    });
  });

  it("keeps existing sessions when loadMore fails", async () => {
    const ws = createFakeWs();
    ws.transcriptList
      .mockResolvedValueOnce(createTranscriptListResult())
      .mockRejectedValueOnce(new Error("transcript.list failed: unavailable: later"));
    const transcript = createTranscriptStore(ws as never);

    await transcript.refresh();
    await transcript.loadMore();

    expect(transcript.getSnapshot().sessions.map((session) => session.conversation_key)).toEqual([
      "session-root",
      "session-child",
    ]);
    expect(transcript.getSnapshot().errorList).toEqual({
      kind: "ws",
      operation: "transcript.list",
      code: "unavailable",
      message: "later",
    });
  });

  it("clears stale detail when refresh no longer includes the selected session", async () => {
    const ws = createFakeWs();
    ws.transcriptList.mockResolvedValueOnce(createTranscriptListResult()).mockResolvedValueOnce({
      conversations: [
        createSessionSummary({
          conversation_id: "session-next-id",
          conversation_key: "session-next",
          thread_id: "thread-next",
          title: "Next session",
        }),
      ],
      next_cursor: null,
    });
    const transcript = createTranscriptStore(ws as never);

    await transcript.refresh();
    await transcript.openSession("session-child");
    await transcript.refresh();

    expect(transcript.getSnapshot().selectedSessionKey).toBe("session-next");
    expect(transcript.getSnapshot().detail).toBeNull();
    expect(transcript.getSnapshot().errorDetail).toBeNull();
  });

  it("ignores blank session opens and loadMore without a cursor", async () => {
    const ws = createFakeWs();
    const transcript = createTranscriptStore(ws as never);

    await transcript.openSession("   ");
    await transcript.loadMore();

    expect(ws.requestDynamic).not.toHaveBeenCalled();
    expect(transcript.getSnapshot()).toMatchObject({
      sessions: [],
      selectedSessionKey: null,
      detail: null,
      loadingList: false,
      loadingDetail: false,
    });
  });
});
