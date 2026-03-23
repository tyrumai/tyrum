import { describe, expect, it } from "vitest";
import {
  buildChildSessionEntries,
  buildRootSessionsByAgent,
} from "../../src/components/pages/agents-page.lib.js";

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    session_id: "session-root-id",
    session_key: "session-root",
    agent_id: "default",
    channel: "ui",
    thread_id: "thread-root",
    title: "Root session",
    message_count: 2,
    updated_at: "2026-03-13T12:00:00.000Z",
    created_at: "2026-03-13T11:00:00.000Z",
    archived: false,
    latest_run_id: null,
    latest_run_status: null,
    has_active_run: false,
    pending_approval_count: 0,
    ...overrides,
  };
}

describe("buildRootSessionsByAgent", () => {
  it("sorts root sessions by updated time descending", () => {
    const rootsByAgent = buildRootSessionsByAgent([
      createSession({
        session_key: "session-older",
        updated_at: "2026-03-13T12:00:00.000Z",
      }),
      createSession({
        session_key: "session-newer",
        updated_at: "2026-03-13T13:00:00.000Z",
      }),
    ]);

    expect(rootsByAgent.get("default")?.map((session) => session.session_key)).toEqual([
      "session-newer",
      "session-older",
    ]);
  });
});

describe("buildChildSessionEntries", () => {
  it("returns child sessions once even when lineage data contains a cycle", () => {
    const sessions = [
      createSession({
        session_id: "session-root-id",
        session_key: "session-root",
        parent_session_key: "session-b",
      }),
      createSession({
        session_id: "session-a-id",
        session_key: "session-a",
        parent_session_key: "session-root",
        created_at: "2026-03-13T11:10:00.000Z",
      }),
      createSession({
        session_id: "session-b-id",
        session_key: "session-b",
        parent_session_key: "session-a",
        created_at: "2026-03-13T11:20:00.000Z",
      }),
    ];
    const sessionsByKey = new Map(sessions.map((session) => [session.session_key, session]));

    const entries = buildChildSessionEntries({
      rootSessionKey: "session-root",
      sessionsByKey,
    });

    expect(entries.map((entry) => entry.session.session_key)).toEqual(["session-a", "session-b"]);
    expect(entries.map((entry) => entry.depth)).toEqual([1, 2]);
  });
});
