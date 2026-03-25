import { describe, expect, it } from "vitest";
import { buildSessionTreeEntries } from "../../src/components/pages/transcripts-page.lib.js";

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    session_id: "session-root-id",
    session_key: "session-root",
    agent_key: "default",
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

describe("buildSessionTreeEntries", () => {
  it("returns all sessions even when lineage data contains a cycle", () => {
    const entries = buildSessionTreeEntries([
      createSession({
        session_id: "session-a-id",
        session_key: "session-a",
        parent_session_key: "session-b",
      }),
      createSession({
        session_id: "session-b-id",
        session_key: "session-b",
        parent_session_key: "session-a",
      }),
    ]);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.session.session_key).toSorted()).toEqual([
      "session-a",
      "session-b",
    ]);
  });
});
