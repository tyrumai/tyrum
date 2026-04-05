import { WsEvent } from "@tyrum/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";
import { TurnItemDal } from "../../src/modules/agent/turn-item-dal.js";
import { finalizeTurn } from "../../src/modules/agent/runtime/turn-finalization.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("finalizeTurn turn_items", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  async function insertTurn(turnId: string): Promise<void> {
    await db?.run(
      `INSERT INTO turn_jobs (
         tenant_id,
         job_id,
         agent_id,
         workspace_id,
         conversation_key,
         status,
         trigger_json,
         input_json,
         created_at
       ) VALUES (?, ?, ?, ?, ?, 'completed', ?, NULL, ?)`,
      [
        DEFAULT_TENANT_ID,
        "22222222-2222-4222-8222-222222222222",
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        "agent:agent-1:main",
        JSON.stringify({ kind: "manual" }),
        "2026-03-13T00:00:00.000Z",
      ],
    );
    await db?.run(
      `INSERT INTO turns (
         tenant_id,
         turn_id,
         job_id,
         conversation_key,
         status,
         attempt,
         created_at,
         started_at,
         finished_at
       ) VALUES (?, ?, ?, ?, 'succeeded', 1, ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        turnId,
        "22222222-2222-4222-8222-222222222222",
        "agent:agent-1:main",
        "2026-03-13T00:00:00.000Z",
        "2026-03-13T00:00:01.000Z",
        "2026-03-13T00:00:02.000Z",
      ],
    );
  }

  function sampleInput(
    responseMessages?: readonly ModelMessage[],
    options?: {
      conversationMessages?: Array<Record<string, unknown>>;
      turnId?: string;
    },
  ) {
    const conversationId = "11111111-1111-4111-8111-111111111111";
    let persistedMessages = [...(options?.conversationMessages ?? [])];
    const replaceMessages = vi.fn(async (input: { messages: Array<Record<string, unknown>> }) => {
      persistedMessages = [...input.messages];
    });
    const getById = vi.fn(async () => ({
      agent_id: "agent-1",
      archived: false,
      channel_thread_id: "thread-1",
      context_state: {
        version: 1,
        recent_message_ids: [],
        checkpoint: null,
        pending_approvals: [],
        pending_tool_state: [],
        updated_at: "2026-03-13T00:00:00.000Z",
      },
      created_at: "2026-03-13T00:00:00.000Z",
      tenant_id: DEFAULT_TENANT_ID,
      conversation_id: conversationId,
      conversation_key: "agent:agent-1:main",
      summary: "",
      title: "Existing title",
      transcript: [],
      updated_at: "2026-03-13T00:00:00.000Z",
      workspace_id: DEFAULT_WORKSPACE_ID,
      messages: persistedMessages,
    }));

    return {
      args: {
        container: {
          artifactStore: undefined as never,
          contextReportDal: { insert: vi.fn(async () => undefined) },
          db: db as never,
          logger: { warn: vi.fn(), info: vi.fn() },
        },
        conversationDal: {
          replaceMessages,
          getById,
          setTitleIfBlank: vi.fn(async () => undefined),
        },
        ctx: {
          config: {
            conversations: {
              loop_detection: {
                cross_turn: {
                  enabled: false,
                  window_assistant_messages: 3,
                  similarity_threshold: 0.95,
                  min_chars: 20,
                  cooldown_assistant_messages: 1,
                },
              },
            },
          },
        },
        conversation: {
          agent_id: "agent-1",
          archived: false,
          channel_thread_id: "thread-1",
          context_state: {
            version: 1,
            recent_message_ids: [],
            checkpoint: null,
            pending_approvals: [],
            pending_tool_state: [],
            updated_at: "2026-03-13T00:00:00.000Z",
          },
          created_at: "2026-03-13T00:00:00.000Z",
          tenant_id: DEFAULT_TENANT_ID,
          conversation_id: conversationId,
          conversation_key: "agent:agent-1:main",
          summary: "",
          title: "Existing title",
          transcript: [],
          updated_at: "2026-03-13T00:00:00.000Z",
          workspace_id: DEFAULT_WORKSPACE_ID,
          messages: persistedMessages,
        },
        resolved: {
          message: "hello",
          parts: [],
          channel: "ui",
          thread_id: "thread-1",
        },
        reply: "ok",
        turn_id: options?.turnId ?? "11111111-1111-4111-8111-111111111112",
        model: {} as never,
        usedTools: new Set<string>(),
        memoryWritten: false,
        contextReport: {
          context_report_id: "report-1",
          generated_at: "2026-03-13T00:00:00.000Z",
          conversation_id: conversationId,
          thread_id: "thread-1",
          channel: "ui",
          agent_id: "agent-1",
          workspace_id: DEFAULT_WORKSPACE_ID,
          tool_calls: [],
          injected_files: [],
        },
        responseMessages,
      } as const,
      getPersistedMessages: () => persistedMessages,
    };
  }

  it("persists ordered message-backed turn_items with finalized timestamps", async () => {
    const turnId = "11111111-1111-4111-8111-111111111112";
    db = openTestSqliteDb();
    await insertTurn(turnId);
    const { args, getPersistedMessages } = sampleInput(
      [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
        } as ModelMessage,
        {
          role: "assistant",
          content: [{ type: "text", text: "draft" }],
        } as ModelMessage,
      ],
      { turnId },
    );

    await finalizeTurn(args);

    const persistedMessages = getPersistedMessages();
    const items = await new TurnItemDal(db).listByTurnId({ tenantId: DEFAULT_TENANT_ID, turnId });
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.item_index)).toEqual([0, 1]);
    expect(items.map((item) => item.payload.message)).toEqual(persistedMessages);
    expect(items.map((item) => item.created_at)).toEqual([
      items[0]?.payload.message.metadata?.created_at,
      items[1]?.payload.message.metadata?.created_at,
    ]);

    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ? ORDER BY id ASC",
      ["ws.broadcast"],
    );
    const events = outbox
      .map((row) => JSON.parse(row.payload_json) as { message?: unknown })
      .map((row) => WsEvent.parse(row.message))
      .filter((event) => event.type === "turn.item.created");
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.payload.turn_item.item_index)).toEqual([0, 1]);
  });

  it("does not duplicate turn_items when finalization retries after transcript persistence", async () => {
    const turnId = "11111111-1111-4111-8111-111111111112";
    db = openTestSqliteDb();
    await insertTurn(turnId);
    const first = sampleInput(
      [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
        } as ModelMessage,
        {
          role: "assistant",
          content: [{ type: "text", text: "draft" }],
        } as ModelMessage,
      ],
      { turnId },
    );

    await finalizeTurn(first.args);
    const firstPersistedMessages = first.getPersistedMessages();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const retry = sampleInput(
      [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
        } as ModelMessage,
        {
          role: "assistant",
          content: [{ type: "text", text: "draft" }],
        } as ModelMessage,
      ],
      { conversationMessages: firstPersistedMessages, turnId },
    );

    await finalizeTurn(retry.args);

    const items = await new TurnItemDal(db).listByTurnId({ tenantId: DEFAULT_TENANT_ID, turnId });
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.payload.message)).toEqual(firstPersistedMessages);

    const outbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ? ORDER BY id ASC",
      ["ws.broadcast"],
    );
    const eventTypes = outbox
      .map((row) => JSON.parse(row.payload_json) as { message?: { type?: string } })
      .map((row) => row.message?.type)
      .filter((type): type is string => typeof type === "string");
    expect(eventTypes.filter((type) => type === "turn.item.created")).toHaveLength(2);

    await db.run("DELETE FROM outbox");

    await finalizeTurn(retry.args);

    const retryOutbox = await db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ? ORDER BY id ASC",
      ["ws.broadcast"],
    );
    const retryEventTypes = retryOutbox
      .map((row) => JSON.parse(row.payload_json) as { message?: { type?: string } })
      .map((row) => row.message?.type)
      .filter((type): type is string => typeof type === "string");
    expect(retryEventTypes.filter((type) => type === "turn.item.created")).toHaveLength(0);
  });

  it("inserts finalized user and assistant messages around an existing approval-backed turn_item", async () => {
    const turnId = "11111111-1111-4111-8111-111111111112";
    db = openTestSqliteDb();
    await insertTurn(turnId);
    await new TurnItemDal(db).ensureItem({
      tenantId: DEFAULT_TENANT_ID,
      turnItemId: "33333333-3333-4333-8333-333333333333",
      turnId,
      itemIndex: 0,
      itemKey: "approval:1",
      kind: "message",
      payload: {
        message: {
          id: "approval-message-1",
          role: "assistant",
          parts: [
            {
              type: "tool-bash",
              toolCallId: "tool-call-1",
              state: "approval-requested",
              input: { command: "printf hi" },
              approval: { id: "approval-1" },
            },
          ],
          metadata: {
            turn_id: turnId,
            created_at: "2026-03-13T00:00:01.500Z",
            approval_id: "approval-1",
          },
        },
      },
      createdAt: "2026-03-13T00:00:01.500Z",
    });

    const { args } = sampleInput(
      [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
        } as ModelMessage,
        {
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        } as ModelMessage,
      ],
      { turnId },
    );

    await finalizeTurn(args);

    const items = await new TurnItemDal(db).listByTurnId({ tenantId: DEFAULT_TENANT_ID, turnId });
    expect(items).toHaveLength(3);
    expect(items.map((item) => item.item_index)).toEqual([0, 1, 2]);
    expect(items.map((item) => item.payload.message.role)).toEqual([
      "user",
      "assistant",
      "assistant",
    ]);
    expect(items[1]?.payload.message.metadata?.approval_id).toBe("approval-1");
  });

  it("attaches local usage metadata to the finalized assistant message", async () => {
    const turnId = "11111111-1111-4111-8111-111111111112";
    db = openTestSqliteDb();
    await insertTurn(turnId);
    const { args } = sampleInput(
      [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "tool-call-1",
              toolName: "bash",
              input: { command: "printf hi" },
            },
          ],
        } as ModelMessage,
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "tool-call-1",
              toolName: "bash",
              output: { stdout: "hi" },
            },
          ],
        } as ModelMessage,
      ],
      { turnId },
    );

    await finalizeTurn({
      ...args,
      localUsageCost: {
        duration_ms: 321,
        total_tokens: 12,
        usd_micros: 34,
      },
    });

    const items = await new TurnItemDal(db).listByTurnId({ tenantId: DEFAULT_TENANT_ID, turnId });
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.payload.message.role)).toEqual(["user", "assistant"]);
    expect(items[1]?.payload.message.metadata?.tyrum_usage).toMatchObject({
      duration_ms: 321,
      total_tokens: 12,
      usd_micros: 34,
    });
    expect(items[0]?.payload.message.metadata?.tyrum_usage).toBeUndefined();
  });

  it("attaches local usage metadata when finalizing without response messages", async () => {
    const turnId = "11111111-1111-4111-8111-111111111112";
    db = openTestSqliteDb();
    await insertTurn(turnId);
    const { args } = sampleInput(undefined, { turnId });

    await finalizeTurn({
      ...args,
      localUsageCost: {
        duration_ms: 654,
        total_tokens: 21,
        usd_micros: 55,
      },
    });

    const items = await new TurnItemDal(db).listByTurnId({ tenantId: DEFAULT_TENANT_ID, turnId });
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.payload.message.role)).toEqual(["user", "assistant"]);
    expect(items[1]?.payload.message.parts).toEqual([{ type: "text", text: "ok" }]);
    expect(items[1]?.payload.message.metadata?.tyrum_usage).toMatchObject({
      duration_ms: 654,
      total_tokens: 21,
      usd_micros: 55,
    });
    expect(items[0]?.payload.message.metadata?.tyrum_usage).toBeUndefined();
  });
});
