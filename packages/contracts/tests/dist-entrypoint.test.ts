import { describe, expect, it } from "vitest";
import * as ContractsDist from "../dist/index.mjs";

describe("@tyrum/contracts dist entrypoint", () => {
  it("accepts the current chat and transcript shapes through the published dist bundle", () => {
    expect(
      ContractsDist.WsChatSessionListRequest.safeParse({
        request_id: "req-chat.session.list",
        type: "chat.session.list",
        payload: {
          agent_key: "default",
          channel: "ui",
        },
      }).success,
    ).toBe(true);

    expect(
      ContractsDist.WsTranscriptListRequest.safeParse({
        request_id: "req-transcript.list",
        type: "transcript.list",
        payload: {
          agent_key: "default",
          channel: "ui",
        },
      }).success,
    ).toBe(true);

    expect(
      ContractsDist.WsChatSessionSummary.safeParse({
        session_id: "session-1",
        agent_key: "default",
        channel: "ui",
        account_key: "default",
        thread_id: "thread-1",
        container_kind: "channel",
        title: "Hello",
        message_count: 1,
        updated_at: "2026-03-13T12:00:00Z",
        created_at: "2026-03-13T12:00:00Z",
        archived: false,
      }).success,
    ).toBe(true);

    expect(
      ContractsDist.TranscriptSessionSummary.safeParse({
        session_id: "session-root-1-id",
        session_key: "session-root-1",
        agent_key: "default",
        channel: "ui",
        account_key: "default",
        thread_id: "thread-root-1",
        container_kind: "channel",
        title: "Root session",
        message_count: 2,
        updated_at: "2026-03-13T12:00:00Z",
        created_at: "2026-03-13T11:00:00Z",
        archived: false,
        latest_run_id: null,
        latest_run_status: null,
        has_active_run: false,
        pending_approval_count: 0,
      }).success,
    ).toBe(true);
  });
});
