import { describe, expect, it, vi } from "vitest";
import * as schemas from "@tyrum/schemas";
import {
  toSessionListRow,
  type RawSessionListRow,
} from "../../src/modules/agent/session-dal-helpers.js";

function rawSessionListRow(transcriptJson: string): RawSessionListRow {
  return {
    session_id: "session-1",
    session_key: "session-key-1",
    agent_key: "agent-1",
    connector_key: "ui",
    provider_thread_id: "thread-1",
    title: "",
    summary: "",
    transcript_json: transcriptJson,
    created_at: "2026-03-09T00:00:00.000Z",
    updated_at: "2026-03-09T00:00:00.000Z",
  };
}

describe("toSessionListRow", () => {
  it("derives transcript previews without validating every item via zod", () => {
    const itemSchemaSpy = vi.spyOn(schemas.SessionTranscriptItem, "safeParse");
    const textItemSchemaSpy = vi.spyOn(schemas.SessionTranscriptTextItem, "safeParse");

    const row = toSessionListRow(
      rawSessionListRow(
        JSON.stringify([
          {
            kind: "text",
            id: "message-1",
            role: "user",
            content: "hello",
            created_at: "2026-03-09T00:00:01.000Z",
          },
          {
            kind: "tool",
            id: "tool-1",
            tool_id: "shell.exec",
            tool_call_id: "call-1",
            status: "completed",
            summary: "",
            created_at: "2026-03-09T00:00:02.000Z",
            updated_at: "2026-03-09T00:00:03.000Z",
          },
          {
            kind: "text",
            id: "message-2",
            role: "assistant",
            content: "world",
            created_at: "2026-03-09T00:00:04.000Z",
          },
        ]),
      ),
      {},
    );

    expect(row.transcript_count).toBe(3);
    expect(row.last_text).toEqual({ role: "assistant", content: "world" });
    expect(itemSchemaSpy).not.toHaveBeenCalled();
    expect(textItemSchemaSpy).not.toHaveBeenCalled();
  });
});
