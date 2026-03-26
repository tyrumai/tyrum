import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import type { SessionContextState, TyrumUIMessage } from "@tyrum/contracts";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import {
  buildSessionSelectSql,
  replaceTranscriptEventsTx,
  upsertConversationStateTx,
} from "../../src/modules/agent/session-dal-helpers.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { ChannelOutboxDal } from "../../src/modules/channels/outbox-dal.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
  IdentityScopeDal,
} from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { seedCompletedTelegramTurn } from "../helpers/channel-session-repair.js";

type SessionInput = {
  agentKey: string;
  channel: string;
  accountKey?: string;
  threadId: string;
  containerKind: "dm" | "group" | "channel";
};

type SessionRecord = Awaited<ReturnType<SessionDal["getOrCreate"]>>;

type SessionStateInput = {
  summary: string;
  turns: unknown[];
  updatedAt?: string;
};

type StoredTurn = {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
};

type RunningExecutionInput = {
  key: string;
  lane: string;
  jobId: string;
  runId: string;
  stepId: string;
  tenantId?: string;
  agentId?: string;
  workspaceId?: string;
};

type InboxMessageInput = {
  source: string;
  threadId: string;
  messageId: string;
  key: string;
  lane: string;
  status: "queued" | "completed";
  session: Pick<SessionRecord, "session_id" | "channel_thread_id">;
  receivedAtMs?: number;
  queueMode?: string;
  workspaceId?: string;
  tenantId?: string;
};

type AuthProfileInput = {
  authProfileId?: string;
  authProfileKey: string;
  providerKey: string;
  nowIso?: string;
  tenantId?: string;
};

type ProviderPinInput = {
  sessionId: string;
  providerKey: string;
  authProfileId: string;
  pinnedAt?: string;
  tenantId?: string;
};

type OverrideInput = {
  key: string;
  lane?: string;
  tenantId?: string;
  updatedAtMs?: number;
};

type RepairTurnInput = {
  session: SessionRecord;
  threadId: string;
  messageId: string;
  userText: string;
  assistantText: string;
  receivedAtMs: number;
  threadKind?: "private" | "group" | "channel";
};

export function buildTurns(count: number, contentPrefix: string, timestampPrefix: string) {
  return Array.from({ length: count }, (_, idx) => ({
    role: idx % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `${contentPrefix}${String(idx)}`,
    timestamp: `${timestampPrefix}${String(idx)}`,
  }));
}

function toStoredMessages(turns: readonly StoredTurn[]): TyrumUIMessage[] {
  return turns.map((turn, index) => ({
    id: `turn-${String(index)}`,
    role: turn.role,
    parts: [{ type: "text", text: turn.content }],
    metadata: turn.timestamp ? { timestamp: turn.timestamp } : undefined,
  }));
}

function toContextState(summary: string, updatedAt: string): SessionContextState {
  return {
    version: 1,
    recent_message_ids: [],
    checkpoint: summary
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
          handoff_md: summary,
        }
      : null,
    pending_approvals: [],
    pending_tool_state: [],
    updated_at: updatedAt,
  };
}

export async function ensureSession(db: SqliteDb, input: SessionInput): Promise<SessionRecord> {
  return await new SessionDal(db, new IdentityScopeDal(db), new ChannelThreadDal(db)).getOrCreate({
    scopeKeys: { agentKey: input.agentKey, workspaceKey: "default" },
    connectorKey: input.channel,
    accountKey: input.accountKey,
    providerThreadId: input.threadId,
    containerKind: input.containerKind,
  });
}

export async function writeSessionState(
  db: SqliteDb,
  session: Pick<SessionRecord, "tenant_id" | "session_id">,
  input: SessionStateInput,
): Promise<void> {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const messages = toStoredMessages(input.turns as StoredTurn[]);
  const contextState = toContextState(input.summary, updatedAt);
  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE conversations
       SET updated_at = ?
       WHERE tenant_id = ? AND conversation_id = ?`,
      [updatedAt, session.tenant_id, session.session_id],
    );
    await replaceTranscriptEventsTx(tx, {
      tenantId: session.tenant_id,
      conversationId: session.session_id,
      messages,
      fallbackCreatedAt: updatedAt,
    });
    await upsertConversationStateTx(tx, {
      tenantId: session.tenant_id,
      conversationId: session.session_id,
      contextState,
    });
  });
}

export async function readSessionRecord(
  db: SqliteDb,
  sessionId: string,
  tenantId = DEFAULT_TENANT_ID,
) {
  return await db.get<{ session_key: string; context_state_json: string; messages_json: string }>(
    `SELECT ${buildSessionSelectSql(db.kind, "s")}
     FROM conversations s
     WHERE s.tenant_id = ? AND s.conversation_id = ?`,
    [tenantId, sessionId],
  );
}

export async function readSessionSnapshot(
  db: SqliteDb,
  sessionId: string,
  tenantId = DEFAULT_TENANT_ID,
) {
  const row = await readSessionRecord(db, sessionId, tenantId);
  const summary = row?.context_state_json
    ? ((JSON.parse(row.context_state_json) as SessionContextState).checkpoint?.handoff_md ?? "")
    : "";
  const turnContents = row?.messages_json
    ? (JSON.parse(row.messages_json) as TyrumUIMessage[]).flatMap((message) =>
        message.parts.flatMap((part) =>
          part.type === "text" && typeof part.text === "string" ? [part.text] : [],
        ),
      )
    : [];
  return { summary, turnsJson: row?.messages_json ?? "[]", turnContents };
}

export async function readSessionAccountKey(
  db: SqliteDb,
  sessionId: string,
  tenantId = DEFAULT_TENANT_ID,
) {
  return await db.get<{ account_key: string }>(
    `SELECT ca.account_key
     FROM conversations s
     JOIN channel_threads ct
       ON ct.tenant_id = s.tenant_id
      AND ct.channel_thread_id = s.channel_thread_id
     JOIN channel_accounts ca
      ON ca.tenant_id = ct.tenant_id
      AND ca.workspace_id = ct.workspace_id
      AND ca.channel_account_id = ct.channel_account_id
     WHERE s.tenant_id = ? AND s.conversation_id = ?`,
    [tenantId, sessionId],
  );
}

export async function seedRunningExecution(
  db: SqliteDb,
  input: RunningExecutionInput,
): Promise<void> {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const agentId = input.agentId ?? DEFAULT_AGENT_ID;
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;

  await db.run(
    `INSERT INTO turn_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       conversation_key,
       lane,
       status,
       trigger_json
     )
     VALUES (?, ?, ?, ?, ?, ?, 'running', '{}')`,
    [tenantId, input.jobId, agentId, workspaceId, input.key, input.lane],
  );
  await db.run(
    `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, lane, status, attempt)
     VALUES (?, ?, ?, ?, ?, 'running', 1)`,
    [tenantId, input.runId, input.jobId, input.key, input.lane],
  );
  await db.run(
    `INSERT INTO execution_steps (tenant_id, step_id, turn_id, step_index, status, action_json)
     VALUES (?, ?, ?, 0, 'running', '{}')`,
    [tenantId, input.stepId, input.runId],
  );
}

export async function seedInboxMessage(db: SqliteDb, input: InboxMessageInput): Promise<void> {
  await db.run(
    `INSERT INTO channel_inbox (
       tenant_id,
       source,
       thread_id,
       message_id,
       key,
       lane,
       received_at_ms,
       payload_json,
       status,
       queue_mode,
       workspace_id,
       session_id,
       channel_thread_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?)`,
    [
      input.tenantId ?? DEFAULT_TENANT_ID,
      input.source,
      input.threadId,
      input.messageId,
      input.key,
      input.lane,
      input.receivedAtMs ?? 1_000,
      input.status,
      input.queueMode ?? "collect",
      input.workspaceId ?? DEFAULT_WORKSPACE_ID,
      input.session.session_id,
      input.session.channel_thread_id,
    ],
  );
}

export async function readRunStatus(db: SqliteDb, runId: string): Promise<string | undefined> {
  const row = await db.get<{ status: string }>(`SELECT status FROM turns WHERE turn_id = ?`, [
    runId,
  ]);
  return row?.status;
}

export async function readInboxStatus(db: SqliteDb, messageId: string) {
  return await db.get<{ status: string; error: string | null }>(
    `SELECT status, error
     FROM channel_inbox
     WHERE message_id = ?`,
    [messageId],
  );
}

export async function writeLaneQueueOverride(db: SqliteDb, input: OverrideInput): Promise<void> {
  await db.run(
    `INSERT INTO conversation_queue_overrides (
       tenant_id,
       conversation_key,
       lane,
       queue_mode,
       updated_at_ms
     )
     VALUES (?, ?, ?, 'interrupt', ?)`,
    [
      input.tenantId ?? DEFAULT_TENANT_ID,
      input.key,
      input.lane ?? "main",
      input.updatedAtMs ?? Date.now(),
    ],
  );
}

export async function writeSendPolicyOverride(db: SqliteDb, input: OverrideInput): Promise<void> {
  await db.run(
    `INSERT INTO conversation_send_policy_overrides (
       tenant_id,
       conversation_key,
       send_policy,
       updated_at_ms
     )
     VALUES (?, ?, 'off', ?)`,
    [input.tenantId ?? DEFAULT_TENANT_ID, input.key, input.updatedAtMs ?? Date.now()],
  );
}

export async function readLaneQueueOverride(
  db: SqliteDb,
  key: string,
  lane = "main",
  tenantId = DEFAULT_TENANT_ID,
): Promise<string | undefined> {
  const row = await db.get<{ queue_mode: string }>(
    `SELECT queue_mode
     FROM conversation_queue_overrides
     WHERE tenant_id = ? AND conversation_key = ? AND lane = ?`,
    [tenantId, key, lane],
  );
  return row?.queue_mode;
}

export async function readSendPolicyOverride(
  db: SqliteDb,
  key: string,
  tenantId = DEFAULT_TENANT_ID,
): Promise<string | undefined> {
  const row = await db.get<{ send_policy: string }>(
    `SELECT send_policy
     FROM conversation_send_policy_overrides
     WHERE tenant_id = ? AND conversation_key = ?`,
    [tenantId, key],
  );
  return row?.send_policy;
}

export async function seedAuthProfile(db: SqliteDb, input: AuthProfileInput): Promise<string> {
  const authProfileId = input.authProfileId ?? randomUUID();
  const nowIso = input.nowIso ?? new Date().toISOString();
  await db.run(
    `INSERT INTO auth_profiles (
       tenant_id,
       auth_profile_id,
       auth_profile_key,
       provider_key,
       type,
       status,
       labels_json,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, 'api_key', 'active', '{}', ?, ?)`,
    [
      input.tenantId ?? DEFAULT_TENANT_ID,
      authProfileId,
      input.authProfileKey,
      input.providerKey,
      nowIso,
      nowIso,
    ],
  );
  return authProfileId;
}

export async function seedSessionProviderPin(db: SqliteDb, input: ProviderPinInput): Promise<void> {
  await db.run(
    `INSERT INTO conversation_provider_pins (
       tenant_id,
       conversation_id,
       provider_key,
       auth_profile_id,
       pinned_at
     ) VALUES (?, ?, ?, ?, ?)`,
    [
      input.tenantId ?? DEFAULT_TENANT_ID,
      input.sessionId,
      input.providerKey,
      input.authProfileId,
      input.pinnedAt ?? new Date().toISOString(),
    ],
  );
}

export async function seedTelegramRepairTurn(db: SqliteDb, input: RepairTurnInput): Promise<void> {
  await seedCompletedTelegramTurn({
    inboxDal: new ChannelInboxDal(db),
    outboxDal: new ChannelOutboxDal(db),
    session: input.session,
    threadId: input.threadId,
    messageId: input.messageId,
    userText: input.userText,
    assistantText: input.assistantText,
    receivedAtMs: input.receivedAtMs,
    threadKind: input.threadKind,
  });
}

export async function withFakeSystemTime<T>(time: string, run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date(time));
    return await run();
  } finally {
    vi.useRealTimers();
  }
}
