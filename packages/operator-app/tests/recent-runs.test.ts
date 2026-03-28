import { describe, expect, it } from "vitest";
import { buildAgentNameByKey, buildRecentActivityState } from "../src/recent-activity.js";

describe("buildRecentActivityState", () => {
  it("uses explicit conversation linkage to enrich source metadata without parsing the turn key", () => {
    const rows = buildRecentActivityState({
      turnsState: {
        turnsById: {
          "run-1": {
            turn_id: "run-1",
            job_id: "job-1",
            conversation_key: "opaque-conversation-key",
            status: "running",
            attempt: 1,
            created_at: "2026-03-13T12:00:00.000Z",
            started_at: "2026-03-13T12:00:01.000Z",
            finished_at: null,
          },
        },
        agentKeyByTurnId: { "run-1": "scout" },
        conversationKeyByTurnId: { "run-1": "conversation-1" },
      },
      transcriptConversations: [
        {
          conversation_id: "conversation-1-id",
          conversation_key: "conversation-1",
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
          latest_turn_id: "run-1",
          latest_turn_status: "running",
          has_active_turn: true,
          pending_approval_count: 0,
        },
      ],
      agentNameByKey: buildAgentNameByKey([
        {
          agent_key: "scout",
          persona: { name: "Scout" },
        },
      ]),
    }).rows;

    expect(rows).toEqual([
      expect.objectContaining({
        turnId: "run-1",
        agentKey: "scout",
        agentName: "Scout",
        conversationKey: "conversation-1",
        turnStatus: "running",
        source: {
          label: "Google Chat DM",
          detail: "thread-42 • ops",
          title: "Google Chat DM • thread-42 • ops",
        },
      }),
    ]);
  });

  it("falls back to conversation-derived labels when transcript linkage is unavailable", () => {
    const rows = buildRecentActivityState({
      turnsState: {
        turnsById: {
          "run-1": {
            turn_id: "run-1",
            job_id: "job-1",
            conversation_key: "agent:default:ui:main",
            status: "succeeded",
            attempt: 1,
            created_at: "2026-03-13T12:00:00.000Z",
            started_at: "2026-03-13T12:00:01.000Z",
            finished_at: "2026-03-13T12:00:10.000Z",
          },
        },
        agentKeyByTurnId: { "run-1": "default" },
        conversationKeyByTurnId: {},
      },
      transcriptConversations: [],
      agentNameByKey: new Map(),
    }).rows;

    expect(rows).toEqual([
      expect.objectContaining({
        turnId: "run-1",
        conversationKey: "agent:default:ui:main",
        turnStatus: "succeeded",
        source: {
          label: "Conversation",
          detail: "Agent conversation",
          title: "Conversation • Agent conversation",
        },
      }),
    ]);
  });

  it("orders activity by transcript conversation recency when conversation summaries are available", () => {
    const rows = buildRecentActivityState({
      turnsState: {
        turnsById: {
          older: {
            turn_id: "older",
            job_id: "job-1",
            conversation_key: "agent:default:ui:older",
            status: "succeeded",
            attempt: 1,
            created_at: "2026-03-13T10:00:00.000Z",
            started_at: "2026-03-13T10:00:01.000Z",
            finished_at: "2026-03-13T10:05:00.000Z",
          },
          newer: {
            turn_id: "newer",
            job_id: "job-2",
            conversation_key: "agent:default:ui:newer",
            status: "running",
            attempt: 1,
            created_at: "2026-03-13T11:00:00.000Z",
            started_at: "2026-03-13T11:00:01.000Z",
            finished_at: null,
          },
        },
        agentKeyByTurnId: { older: "default", newer: "default" },
        conversationKeyByTurnId: {},
      },
      transcriptConversations: [
        {
          conversation_id: "older-id",
          conversation_key: "agent:default:ui:older",
          agent_key: "default",
          channel: "ui",
          thread_id: "older",
          title: "Older",
          message_count: 1,
          updated_at: "2026-03-13T10:05:00.000Z",
          created_at: "2026-03-13T10:00:00.000Z",
          archived: false,
          latest_turn_id: "older",
          latest_turn_status: "succeeded",
          has_active_turn: false,
          pending_approval_count: 0,
        },
        {
          conversation_id: "newer-id",
          conversation_key: "agent:default:ui:newer",
          agent_key: "default",
          channel: "ui",
          thread_id: "newer",
          title: "Newer",
          message_count: 1,
          updated_at: "2026-03-13T11:00:01.000Z",
          created_at: "2026-03-13T11:00:00.000Z",
          archived: false,
          latest_turn_id: "newer",
          latest_turn_status: "running",
          has_active_turn: true,
          pending_approval_count: 0,
        },
      ],
      agentNameByKey: new Map(),
    }).rows;

    expect(rows.map((row) => row.turnId)).toEqual(["newer", "older"]);
  });

  it("merges retained conversations with newer standalone turns and sorts the combined activity", () => {
    const rows = buildRecentActivityState({
      turnsState: {
        turnsById: {
          "run-ui": {
            turn_id: "run-ui",
            job_id: "job-ui",
            conversation_key: "agent:default:ui:main",
            status: "succeeded",
            attempt: 1,
            created_at: "2026-03-13T10:00:00.000Z",
            started_at: "2026-03-13T10:00:01.000Z",
            finished_at: "2026-03-13T10:05:00.000Z",
          },
          "run-cron": {
            turn_id: "run-cron",
            job_id: "job-cron",
            conversation_key: "cron:nightly",
            status: "running",
            attempt: 1,
            created_at: "2026-03-13T11:00:00.000Z",
            started_at: "2026-03-13T11:00:01.000Z",
            finished_at: null,
          },
        },
        agentKeyByTurnId: {
          "run-ui": "default",
          "run-cron": "default",
        },
        conversationKeyByTurnId: {
          "run-ui": "agent:default:ui:main",
          "run-cron": "cron:nightly",
        },
      },
      transcriptConversations: [
        {
          conversation_id: "conversation-ui",
          conversation_key: "agent:default:ui:main",
          agent_key: "default",
          channel: "ui",
          thread_id: "main",
          title: "Main UI thread",
          message_count: 1,
          updated_at: "2026-03-13T10:05:00.000Z",
          created_at: "2026-03-13T10:00:00.000Z",
          archived: false,
          latest_turn_id: "run-ui",
          latest_turn_status: "succeeded",
          has_active_turn: false,
          pending_approval_count: 0,
        },
      ],
      agentNameByKey: new Map([["default", "Default"]]),
    }).rows;

    expect(rows.map((row) => row.turnId)).toEqual(["run-cron", "run-ui"]);
    expect(rows.map((row) => row.conversationKey)).toEqual([
      "cron:nightly",
      "agent:default:ui:main",
    ]);
    expect(rows.map((row) => row.source.label)).toEqual(["Cron", "UI"]);
  });

  it("prefers a newer turn over stale retained transcript activity for the same conversation", () => {
    const rows = buildRecentActivityState({
      turnsState: {
        turnsById: {
          "turn-old": {
            turn_id: "turn-old",
            job_id: "job-old",
            conversation_key: "agent:default:ui:main",
            status: "succeeded",
            attempt: 1,
            created_at: "2026-03-13T10:00:00.000Z",
            started_at: "2026-03-13T10:00:01.000Z",
            finished_at: "2026-03-13T10:05:00.000Z",
          },
          "turn-new": {
            turn_id: "turn-new",
            job_id: "job-new",
            conversation_key: "agent:default:ui:main",
            status: "running",
            attempt: 2,
            created_at: "2026-03-13T11:00:00.000Z",
            started_at: "2026-03-13T11:00:01.000Z",
            finished_at: null,
          },
        },
        agentKeyByTurnId: {
          "turn-old": "default",
          "turn-new": "default",
        },
        conversationKeyByTurnId: {
          "turn-old": "agent:default:ui:main",
          "turn-new": "agent:default:ui:main",
        },
      },
      transcriptConversations: [
        {
          conversation_id: "conversation-ui",
          conversation_key: "agent:default:ui:main",
          agent_key: "default",
          channel: "ui",
          thread_id: "main",
          title: "Main UI thread",
          message_count: 1,
          updated_at: "2026-03-13T10:05:00.000Z",
          created_at: "2026-03-13T10:00:00.000Z",
          archived: false,
          latest_turn_id: "turn-old",
          latest_turn_status: "succeeded",
          has_active_turn: false,
          pending_approval_count: 0,
        },
      ],
      agentNameByKey: new Map([["default", "Default"]]),
    }).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        id: "turn-new",
        turnId: "turn-new",
        turnAttempt: 2,
        conversationKey: "agent:default:ui:main",
        turnStatus: "running",
        occurredAt: "2026-03-13T11:00:01.000Z",
      }),
    );
  });
});
