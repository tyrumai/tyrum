import { describe, expect, it } from "vitest";
import {
  buildChildSessionEntries,
  buildChildSessionsByParentKey,
  buildRootSessionsByAgent,
} from "../../src/components/pages/agents-page.lib.js";

function createSession(overrides: Record<string, unknown> = {}) {
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

describe("buildRootSessionsByAgent", () => {
  it("sorts root sessions by updated time descending", () => {
    const rootsByAgent = buildRootSessionsByAgent([
      createSession({
        conversation_key: "session-older",
        updated_at: "2026-03-13T12:00:00.000Z",
      }),
      createSession({
        conversation_key: "session-newer",
        updated_at: "2026-03-13T13:00:00.000Z",
      }),
    ]);

    expect(rootsByAgent.get("default")?.map((session) => session.conversation_key)).toEqual([
      "session-newer",
      "session-older",
    ]);
  });
});

describe("buildChildSessionEntries", () => {
  it("returns child sessions once even when lineage data contains a cycle", () => {
    const sessions = [
      createSession({
        conversation_id: "session-root-id",
        conversation_key: "session-root",
        parent_conversation_key: "session-b",
      }),
      createSession({
        conversation_id: "session-a-id",
        conversation_key: "session-a",
        parent_conversation_key: "session-root",
        created_at: "2026-03-13T11:10:00.000Z",
      }),
      createSession({
        conversation_id: "session-b-id",
        conversation_key: "session-b",
        parent_conversation_key: "session-a",
        created_at: "2026-03-13T11:20:00.000Z",
      }),
    ];
    const sessionsByKey = new Map(sessions.map((session) => [session.conversation_key, session]));
    const childrenByParentKey = buildChildSessionsByParentKey(sessionsByKey);

    const entries = buildChildSessionEntries({
      rootSessionKey: "session-root",
      childrenByParentKey,
    });

    expect(entries.map((entry) => entry.session.conversation_key)).toEqual([
      "session-a",
      "session-b",
    ]);
    expect(entries.map((entry) => entry.depth)).toEqual([1, 2]);
  });
});
