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
    responseMessages: readonly ModelMessage[],
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
  });
});
