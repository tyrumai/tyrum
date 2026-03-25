import { describe, expect, it } from "vitest";
import {
  buildAgentNameByKey,
  buildRecentRunsState,
  buildTranscriptSessionsByKey,
} from "../src/recent-runs.js";

describe("buildRecentRunsState", () => {
  it("uses explicit session linkage to enrich source metadata without parsing the run key", () => {
    const rows = buildRecentRunsState({
      runsState: {
        runsById: {
          "run-1": {
            run_id: "run-1",
            job_id: "job-1",
            key: "opaque-run-key",
            lane: "main",
            status: "running",
            attempt: 1,
            created_at: "2026-03-13T12:00:00.000Z",
            started_at: "2026-03-13T12:00:01.000Z",
            finished_at: null,
          },
        },
        agentKeyByRunId: { "run-1": "scout" },
        sessionKeyByRunId: { "run-1": "session-1" },
      },
      transcriptSessionsByKey: buildTranscriptSessionsByKey([
        {
          session_id: "session-1-id",
          session_key: "session-1",
          agent_key: "scout",
          channel: "googlechat",
          account_key: "ops",
          thread_id: "thread-42",
          container_kind: "dm",
          title: "Ops thread",
          message_count: 2,
          updated_at: "2026-03-13T12:00:05.000Z",
          created_at: "2026-03-13T11:59:00.000Z",
          archived: false,
          latest_run_id: "run-1",
          latest_run_status: "running",
          has_active_run: true,
          pending_approval_count: 0,
        },
      ]),
      agentNameByKey: buildAgentNameByKey([
        {
          agent_key: "scout",
          persona: { name: "Scout" },
        },
      ]),
    }).rows;

    expect(rows).toEqual([
      expect.objectContaining({
        runId: "run-1",
        agentKey: "scout",
        agentName: "Scout",
        sessionKey: "session-1",
        source: {
          label: "Google Chat DM",
          detail: "thread-42 • ops",
          title: "Google Chat DM • thread-42 • ops",
        },
      }),
    ]);
  });

  it("falls back to lane-derived labels when transcript linkage is unavailable", () => {
    const rows = buildRecentRunsState({
      runsState: {
        runsById: {
          "run-1": {
            run_id: "run-1",
            job_id: "job-1",
            key: "opaque-run-key",
            lane: "heartbeat",
            status: "succeeded",
            attempt: 1,
            created_at: "2026-03-13T12:00:00.000Z",
            started_at: "2026-03-13T12:00:01.000Z",
            finished_at: "2026-03-13T12:00:10.000Z",
          },
        },
        agentKeyByRunId: { "run-1": "default" },
        sessionKeyByRunId: {},
      },
      transcriptSessionsByKey: new Map(),
      agentNameByKey: new Map(),
    }).rows;

    expect(rows).toEqual([
      expect.objectContaining({
        runId: "run-1",
        sessionKey: null,
        source: {
          label: "Heartbeat",
          detail: "Agent main",
          title: "Heartbeat • Agent main",
        },
      }),
    ]);
  });

  it("orders runs by their most recent execution timestamp", () => {
    const rows = buildRecentRunsState({
      runsState: {
        runsById: {
          older: {
            run_id: "older",
            job_id: "job-1",
            key: "key-1",
            lane: "main",
            status: "succeeded",
            attempt: 1,
            created_at: "2026-03-13T10:00:00.000Z",
            started_at: "2026-03-13T10:00:01.000Z",
            finished_at: "2026-03-13T10:05:00.000Z",
          },
          newer: {
            run_id: "newer",
            job_id: "job-2",
            key: "key-2",
            lane: "main",
            status: "running",
            attempt: 1,
            created_at: "2026-03-13T11:00:00.000Z",
            started_at: "2026-03-13T11:00:01.000Z",
            finished_at: null,
          },
        },
        agentKeyByRunId: { older: "default", newer: "default" },
        sessionKeyByRunId: {},
      },
      transcriptSessionsByKey: new Map(),
      agentNameByKey: new Map(),
    }).rows;

    expect(rows.map((row) => row.runId)).toEqual(["newer", "older"]);
  });
});
