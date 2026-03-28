import { afterEach, describe, expect, it } from "vitest";
import { executeCommand } from "../../src/modules/commands/dispatcher.js";
import { ConversationDal } from "../../src/modules/agent/conversation-dal.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { IdentityScopeDal, DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import * as support from "./command-conversation-primitives.test-support.js";

describe("conversation command primitives", () => {
  let db: ReturnType<typeof openTestSqliteDb> | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("supports /new with empty messages and empty prompt context", async () => {
    db = openTestSqliteDb();

    const result = await executeCommand("/new", {
      db,
      commandContext: { agentId: "default", channel: "ui:default", threadId: "thread-1" },
    });

    const payload = result.data as { conversation_id: string; thread_id: string };
    const stored = await support.readConversationRecord(db, payload.conversation_id);
    expect(payload.thread_id).toMatch(/^ui-/);
    expect(stored?.conversation_key).toContain(`:channel:${payload.thread_id}`);
    expect(stored?.messages_json).toBe("[]");
    expect(stored?.context_state_json).toContain('"checkpoint":null');
  });

  it("supports /compact via the runtime and leaves durable messages intact", async () => {
    db = openTestSqliteDb();
    const conversation = await support.ensureConversation(db, {
      agentKey: "default",
      channel: "ui",
      threadId: "thread-1",
      containerKind: "channel",
    });
    await support.writeConversationState(db, conversation, {
      summary: "summary before compact",
      turns: support.buildTurns(4, "msg-", "t-"),
    });

    const result = await executeCommand("/compact", {
      db,
      agents: {
        getRuntime: async () => ({
          compactConversation: async ({ conversationId }: { conversationId: string }) => {
            const dal = new ConversationDal(db!, new IdentityScopeDal(db!), new ChannelThreadDal(db!));
            await dal.replaceContextState({
              tenantId: DEFAULT_TENANT_ID,
              conversationId,
              contextState: {
                version: 1,
                compacted_through_message_id: "turn-1",
                recent_message_ids: ["turn-2", "turn-3"],
                checkpoint: {
                  goal: "",
                  user_constraints: [],
                  decisions: [],
                  discoveries: [],
                  completed_work: [],
                  pending_work: ["follow up"],
                  unresolved_questions: [],
                  critical_identifiers: [],
                  relevant_files: [],
                  handoff_md: "summary after compact",
                },
                pending_approvals: [],
                pending_tool_state: [],
                updated_at: "2026-02-17T00:10:00.000Z",
              },
            });
            return {
              compacted: true,
              droppedMessages: 2,
              keptMessages: 2,
              summary: "summary after compact",
              reason: "model" as const,
            };
          },
        }),
      } as never,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-1" },
    });

    expect(result.data).toMatchObject({
      agent_id: "default",
      conversation_id: conversation.conversation_id,
      dropped_messages: 2,
      kept_messages: 2,
    });
    const snapshot = await support.readConversationSnapshot(db, conversation.conversation_id);
    expect(snapshot.summary).toBe("summary after compact");
    expect(snapshot.turnContents).toEqual(["msg-0", "msg-1", "msg-2", "msg-3"]);
  });

  it("supports /reset and clears conversation messages plus prompt context", async () => {
    db = openTestSqliteDb();
    const conversation = await support.ensureConversation(db, {
      agentKey: "default",
      channel: "ui",
      threadId: "thread-reset",
      containerKind: "channel",
    });
    await support.writeConversationState(db, conversation, {
      summary: "to-reset",
      turns: support.buildTurns(2, "msg-", "t-"),
    });

    const result = await executeCommand("/reset", {
      db,
      commandContext: { agentId: "default", channel: "ui", threadId: "thread-reset" },
    });

    expect(result.data).toMatchObject({ agent_id: "default", conversation_id: conversation.conversation_id });
    const snapshot = await support.readConversationSnapshot(db, conversation.conversation_id);
    expect(snapshot.summary).toBe("");
    expect(snapshot.turnContents).toEqual([]);
  });
});
