import { SessionDal } from "../../src/modules/agent/session-dal.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SessionDalOptions } from "../../src/modules/agent/session-dal.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { ChannelOutboxDal } from "../../src/modules/channels/outbox-dal.js";
import { seedCompletedTelegramTurn } from "../helpers/channel-session-repair.js";
import type { SessionRow } from "../../src/modules/agent/session-dal.js";
import type { SessionContextState, TyrumUIMessage } from "@tyrum/schemas";

export function textTranscript(session: { messages?: TyrumUIMessage[] | undefined }) {
  return (session.messages ?? [])
    .flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "text" && typeof part.text === "string"
          ? [
              {
                id: message.id,
                role: message.role,
                content: part.text,
                created_at:
                  typeof message.metadata?.["timestamp"] === "string"
                    ? message.metadata["timestamp"]
                    : "",
              },
            ]
          : [],
      ),
    )
    .filter((item) => item.content.length > 0);
}

export function createSessionDalFixture(): { db: SqliteDb; dal: SessionDal } {
  return createObservedSessionDalFixture();
}

export function createObservedSessionDalFixture(options?: SessionDalOptions): {
  db: SqliteDb;
  dal: SessionDal;
} {
  const db = openTestSqliteDb();
  const identityScopeDal = new IdentityScopeDal(db, { cacheTtlMs: 60_000 });
  const channelThreadDal = new ChannelThreadDal(db);
  return {
    db,
    dal: new SessionDal(db, identityScopeDal, channelThreadDal, options),
  };
}

export async function appendTranscriptTurn(input: {
  dal: SessionDal;
  tenantId: string;
  sessionId: string;
  userMessage: string;
  assistantMessage: string;
  timestamp: string;
}) {
  return await input.dal.appendTurn({
    tenantId: input.tenantId,
    sessionId: input.sessionId,
    userMessage: input.userMessage,
    assistantMessage: input.assistantMessage,
    timestamp: input.timestamp,
  });
}

export async function appendThreeTranscriptTurns(input: {
  dal: SessionDal;
  tenantId: string;
  sessionId: string;
}) {
  await appendTranscriptTurn({
    ...input,
    userMessage: "u1",
    assistantMessage: "a1",
    timestamp: "2026-02-17T00:00:00.000Z",
  });
  await appendTranscriptTurn({
    ...input,
    userMessage: "u2",
    assistantMessage: "a2",
    timestamp: "2026-02-17T00:01:00.000Z",
  });
  return await appendTranscriptTurn({
    ...input,
    userMessage: "u3",
    assistantMessage: "a3",
    timestamp: "2026-02-17T00:02:00.000Z",
  });
}

export async function seedRepairTurns(input: {
  db: SqliteDb;
  dal: SessionDal;
  session: SessionRow;
  threadId: string;
  turns: Array<{
    messageId: string;
    userText: string;
    assistantText: string;
    receivedAtMs: number;
  }>;
}) {
  const inboxDal = new ChannelInboxDal(input.db, input.dal);
  const outboxDal = new ChannelOutboxDal(input.db);
  for (const turn of input.turns) {
    await seedCompletedTelegramTurn({
      inboxDal,
      outboxDal,
      session: input.session,
      threadId: input.threadId,
      ...turn,
    });
  }
}

export async function setSessionTranscriptAndSummary(input: {
  db: SqliteDb;
  session: SessionRow;
  transcriptJson: string;
  summary: string;
  updatedAt: string;
}) {
  const parsedMessages = (
    JSON.parse(input.transcriptJson) as Array<{
      role: "user" | "assistant" | "system";
      content: string;
      created_at?: string;
    }>
  ).map(
    (turn, index): TyrumUIMessage => ({
      id: `turn-${String(index)}`,
      role: turn.role,
      parts: [{ type: "text", text: turn.content }],
      metadata: turn.created_at ? { timestamp: turn.created_at } : undefined,
    }),
  );
  const contextState: SessionContextState = {
    version: 1,
    recent_message_ids: parsedMessages.map((message) => message.id),
    checkpoint: input.summary
      ? {
          goal: "",
          user_constraints: [],
          decisions: [],
          discoveries: [],
          completed_work: [],
          pending_work: [],
          unresolved_questions: [],
          critical_identifiers: [],
          relevant_files: [],
          handoff_md: input.summary,
        }
      : null,
    pending_approvals: [],
    pending_tool_state: [],
    updated_at: input.updatedAt,
  };
  await input.db.run(
    `UPDATE sessions
     SET messages_json = ?, context_state_json = ?, updated_at = ?
     WHERE tenant_id = ? AND session_id = ?`,
    [
      JSON.stringify(parsedMessages),
      JSON.stringify(contextState),
      input.updatedAt,
      input.session.tenant_id,
      input.session.session_id,
    ],
  );
}

export async function setSessionUpdatedAt(input: {
  db: SqliteDb;
  tenantId: string;
  sessionIds: string[];
  valueSql: string;
}) {
  const placeholders = input.sessionIds.map(() => "?").join(", ");
  await input.db.run(
    `UPDATE sessions SET updated_at = ${input.valueSql} WHERE tenant_id = ? AND session_id IN (${placeholders})`,
    [input.tenantId, ...input.sessionIds],
  );
}
