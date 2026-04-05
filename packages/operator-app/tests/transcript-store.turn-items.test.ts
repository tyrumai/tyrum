import { describe, expect, it } from "vitest";
import { createTranscriptStore } from "../src/stores/transcript-store.js";
import { createFakeWs, createTranscriptGetResult } from "./transcript-store.test-support.js";

describe("createTranscriptStore turn items", () => {
  it("treats duplicate turn-item events as a no-op", async () => {
    const ws = createFakeWs();
    const turnId = "11111111-2222-4333-8444-555555555555";
    ws.transcriptGet.mockResolvedValueOnce(
      createTranscriptGetResult({
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
                conversation_key: "agent:default:ui:default:channel:thread-child",
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

    const turnItem = {
      turn_item_id: "11111111-2222-4333-8444-777777777777",
      turn_id: turnId,
      item_index: 0,
      item_key: "message:assistant-1",
      kind: "message" as const,
      created_at: "2026-03-13T12:02:00.000Z",
      payload: {
        message: {
          id: "assistant-1",
          role: "assistant" as const,
          parts: [{ type: "text", text: "Turn item arrived." }],
          metadata: { turn_id: turnId, created_at: "2026-03-13T12:02:00.000Z" },
        },
      },
    };

    transcript.handleTurnItemCreated(turnItem);
    const snapshotBeforeDuplicate = transcript.getSnapshot();
    let notifications = 0;
    const unsubscribe = transcript.subscribe(() => {
      notifications += 1;
    });

    transcript.handleTurnItemCreated(structuredClone(turnItem));

    unsubscribe();

    expect(transcript.getSnapshot()).toBe(snapshotBeforeDuplicate);
    expect(notifications).toBe(0);
  });
});
