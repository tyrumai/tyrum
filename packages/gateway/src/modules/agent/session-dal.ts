import { randomUUID } from "node:crypto";
import {
  NormalizedThreadMessage as NormalizedThreadMessageSchema,
  SessionTranscriptTextItem,
} from "@tyrum/schemas";
import type { NormalizedContainerKind, SessionTranscriptItem } from "@tyrum/schemas";
import { safeJsonParse } from "../../utils/json.js";
import type { SqlDb } from "../../statestore/types.js";
import {
  DEFAULT_CHANNEL_ACCOUNT_ID,
  normalizeAccountId,
  normalizeConnectorId,
} from "../channels/interface.js";
import { ChannelThreadDal } from "../channels/thread-dal.js";
import type { IdentityScopeDal, ScopeKeys } from "../identity/scope.js";
import { DEFAULT_TENANT_KEY, normalizeScopeKeys } from "../identity/scope.js";
import { Logger } from "../observability/logger.js";
import { gatewayMetrics } from "../observability/metrics.js";
import { type PersistedJsonObserver } from "../observability/persisted-json.js";
import { renderNormalizedThreadMessageText } from "./session-message-text.js";
import { buildAgentTurnKey } from "./turn-key.js";
import type {
  RawChannelTranscriptRow,
  RawSessionListRow,
  RawSessionRow,
  RawSessionWithDeliveryRow,
  SessionDalOptions,
  SessionIdentity,
  SessionListRow,
  SessionRepairResult,
  SessionRow,
  SessionWithDelivery,
  StoredTranscript,
} from "./session-dal-helpers.js";
import {
  buildStoredTranscript,
  countTextTranscriptItems,
  normalizeSessionTitle,
  normalizeContainerKind,
  normalizeRepairTimestamp,
  normalizeTime,
  REPAIR_SESSION_SQL,
  toSessionListRow,
  toSessionRow,
  UPDATE_SESSION_SQL,
  WITH_DELIVERY_SQL,
} from "./session-dal-helpers.js";
import {
  buildSessionListWhereClause,
  decodeSessionCursor,
  encodeSessionCursor,
  latestTranscriptTimestamp,
  loadOutboxReplyText,
  stringifySessionTranscript,
  sortSessionTranscript,
} from "./session-dal-runtime.js";
export type {
  SessionRow,
  SessionListRow,
  SessionWithDelivery,
  SessionDalOptions,
  SessionRepairResult,
} from "./session-dal-helpers.js";

const logger = new Logger({ base: { module: "agent.session_dal" } });

function preserveNonTextCreatedAt(
  existing: SessionTranscriptItem | undefined,
  next: SessionTranscriptItem,
): SessionTranscriptItem {
  if (!existing || existing.kind !== next.kind || next.kind === "text") {
    return next;
  }
  return { ...next, created_at: existing.created_at };
}

export class SessionDal {
  private readonly jsonObserver: PersistedJsonObserver;

  constructor(
    private readonly db: SqlDb,
    private readonly identityScopeDal: IdentityScopeDal,
    private readonly channelThreadDal: ChannelThreadDal,
    opts?: SessionDalOptions,
  ) {
    this.jsonObserver = {
      logger: opts?.logger ?? logger,
      metrics: opts?.metrics ?? gatewayMetrics,
    };
  }

  private async getRawSession(
    column: "session_id" | "session_key",
    tenantId: string,
    value: string,
  ): Promise<RawSessionRow | undefined> {
    return this.db.get<RawSessionRow>(
      `SELECT * FROM sessions WHERE tenant_id = ? AND ${column} = ? LIMIT 1`,
      [tenantId, value],
    );
  }

  private async requireSession(input: SessionIdentity): Promise<SessionRow> {
    const session = await this.getById(input);
    if (!session) throw new Error(`session '${input.sessionId}' not found`);
    return session;
  }

  private async writeSession(
    input: SessionIdentity & { stored: StoredTranscript; updatedAt?: string },
  ): Promise<void> {
    await this.db.run(UPDATE_SESSION_SQL, [
      stringifySessionTranscript(input.stored.transcript),
      input.stored.title,
      input.stored.summary,
      input.updatedAt ?? new Date().toISOString(),
      input.tenantId,
      input.sessionId,
    ]);
  }

  async replaceTranscript(
    input: SessionIdentity & {
      transcript: SessionTranscriptItem[];
      summary: string;
      title?: string;
      updatedAt?: string;
    },
  ): Promise<void> {
    await this.writeSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      updatedAt: input.updatedAt,
      stored: {
        transcript: input.transcript,
        title: normalizeSessionTitle(input.title ?? ""),
        summary: input.summary,
        droppedMessages: 0,
      },
    });
  }

  async getById(input: { tenantId: string; sessionId: string }): Promise<SessionRow | undefined> {
    const row = await this.getRawSession("session_id", input.tenantId, input.sessionId);
    return row ? toSessionRow(row, this.jsonObserver) : undefined;
  }

  async getByKey(input: { tenantId: string; sessionKey: string }): Promise<SessionRow | undefined> {
    const row = await this.getRawSession("session_key", input.tenantId, input.sessionKey);
    return row ? toSessionRow(row, this.jsonObserver) : undefined;
  }

  async getWithDeliveryByKey(input: {
    tenantId: string;
    sessionKey: string;
  }): Promise<SessionWithDelivery | undefined> {
    const row = await this.db.get<RawSessionWithDeliveryRow>(WITH_DELIVERY_SQL, [
      input.tenantId,
      input.sessionKey,
    ]);
    return row
      ? {
          session: toSessionRow(row, this.jsonObserver),
          agent_key: row.agent_key,
          workspace_key: row.workspace_key,
          connector_key: row.connector_key,
          account_key: row.account_key,
          provider_thread_id: row.provider_thread_id,
          container_kind: normalizeContainerKind(row.container_kind),
        }
      : undefined;
  }

  async getOrCreate(input: {
    tenantId?: string;
    scopeKeys?: Partial<ScopeKeys>;
    connectorKey: string;
    accountKey?: string;
    providerThreadId: string;
    containerKind: NormalizedContainerKind;
  }): Promise<SessionRow> {
    const keys = normalizeScopeKeys(input.scopeKeys);
    const tenantId =
      input.tenantId?.trim() || (await this.identityScopeDal.ensureTenantId(keys.tenantKey));
    const agentId = await this.identityScopeDal.ensureAgentId(tenantId, keys.agentKey);
    const workspaceId = await this.identityScopeDal.ensureWorkspaceId(tenantId, keys.workspaceKey);
    await this.identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);

    const connectorKey = normalizeConnectorId(input.connectorKey);
    const accountKey = normalizeAccountId(input.accountKey);
    const channelAccountId = await this.channelThreadDal.ensureChannelAccountId({
      tenantId,
      workspaceId,
      connectorKey,
      accountKey,
    });
    const channelThreadId = await this.channelThreadDal.ensureChannelThreadId({
      tenantId,
      workspaceId,
      channelAccountId,
      providerThreadId: input.providerThreadId,
      containerKind: input.containerKind,
    });
    const sessionKey = buildAgentTurnKey({
      agentId: keys.agentKey,
      workspaceId: keys.workspaceKey,
      channel: connectorKey,
      containerKind: input.containerKind,
      threadId: input.providerThreadId,
      deliveryAccount: accountKey === DEFAULT_CHANNEL_ACCOUNT_ID ? undefined : accountKey,
    });

    const existing = await this.getByKey({ tenantId, sessionKey });
    if (existing) return existing;

    const nowIso = new Date().toISOString();
    const inserted = await this.db.get<RawSessionRow>(
      "INSERT INTO sessions (tenant_id, session_id, session_key, agent_id, workspace_id, channel_thread_id, title, summary, transcript_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '', '', '[]', ?, ?) ON CONFLICT (tenant_id, session_key) DO NOTHING RETURNING *",
      [tenantId, randomUUID(), sessionKey, agentId, workspaceId, channelThreadId, nowIso, nowIso],
    );
    if (inserted) return toSessionRow(inserted, this.jsonObserver);

    const created = await this.getByKey({ tenantId, sessionKey });
    if (!created) throw new Error("failed to create session");
    return created;
  }

  async list(input: {
    scopeKeys?: Partial<ScopeKeys>;
    connectorKey?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ sessions: SessionListRow[]; nextCursor: string | null }> {
    const keys = normalizeScopeKeys(input.scopeKeys);
    const scopeIds = await this.identityScopeDal.resolveScopeIds(keys);
    const connectorKeyRaw = input.connectorKey?.trim();
    const connectorKey = connectorKeyRaw ? normalizeConnectorId(connectorKeyRaw) : undefined;
    const limit = Math.min(200, Math.max(1, Math.floor(input.limit ?? 50)));
    const cursor = input.cursor ? decodeSessionCursor(input.cursor) : undefined;
    if (input.cursor && !cursor) throw new Error("invalid cursor");
    const { where, params } = buildSessionListWhereClause({
      tenantId: scopeIds.tenantId,
      agentId: scopeIds.agentId,
      workspaceId: scopeIds.workspaceId,
      connectorKey,
      cursor,
    });

    const rows = await this.db.all<RawSessionListRow>(
      `SELECT s.session_id, s.session_key, ag.agent_key, ca.connector_key, ct.provider_thread_id, s.title, s.summary, s.transcript_json, s.created_at, s.updated_at FROM sessions s JOIN agents ag ON ag.tenant_id = s.tenant_id AND ag.agent_id = s.agent_id JOIN channel_threads ct ON ct.tenant_id = s.tenant_id AND ct.workspace_id = s.workspace_id AND ct.channel_thread_id = s.channel_thread_id JOIN channel_accounts ca ON ca.tenant_id = ct.tenant_id AND ca.workspace_id = ct.workspace_id AND ca.channel_account_id = ct.channel_account_id WHERE ${where.join(" AND ")} ORDER BY s.updated_at DESC, s.session_id DESC LIMIT ?`,
      [...params, limit + 1],
    );
    const selectedRows = rows.slice(0, limit);
    const last = selectedRows.at(-1);
    return {
      sessions: selectedRows.map((row) => toSessionListRow(row, this.jsonObserver)),
      nextCursor:
        rows.length > limit && last
          ? encodeSessionCursor({
              updated_at: normalizeTime(last.updated_at),
              session_id: last.session_id,
            })
          : null,
    };
  }

  async reset(input: SessionIdentity): Promise<boolean> {
    const res = await this.db.run(
      "UPDATE sessions SET transcript_json = '[]', title = '', summary = '', updated_at = ? WHERE tenant_id = ? AND session_id = ?",
      [new Date().toISOString(), input.tenantId, input.sessionId],
    );
    return res.changes === 1;
  }

  async appendTurn(input: {
    tenantId: string;
    sessionId: string;
    userMessage: string;
    assistantMessage: string;
    maxTurns?: number;
    timestamp: string;
  }): Promise<SessionRow> {
    const session = await this.requireSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
    });
    const transcript: SessionTranscriptItem[] = [
      ...session.transcript,
      SessionTranscriptTextItem.parse({
        kind: "text",
        id: randomUUID(),
        role: "user",
        content: input.userMessage,
        created_at: input.timestamp,
      }),
      SessionTranscriptTextItem.parse({
        kind: "text",
        id: randomUUID(),
        role: "assistant",
        content: input.assistantMessage,
        created_at: input.timestamp,
      }),
    ];
    const maxTurns = input.maxTurns ?? 0;
    if (maxTurns > 0) {
      const stored = buildStoredTranscript({
        transcript,
        keepLastMessages: maxTurns * 2,
        previousTitle: session.title,
        previousSummary: session.summary,
      });
      await this.writeSession({
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        stored,
        updatedAt: input.timestamp,
      });
    } else {
      await this.replaceTranscript({
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        transcript,
        title: session.title,
        summary: session.summary,
        updatedAt: input.timestamp,
      });
    }

    const updated = await this.getById({ tenantId: input.tenantId, sessionId: input.sessionId });
    if (!updated) throw new Error(`session '${input.sessionId}' missing after update`);
    return updated;
  }

  async upsertTranscriptItem(
    input: SessionIdentity & {
      item: SessionTranscriptItem;
      summary?: string;
      title?: string;
      updatedAt?: string;
    },
  ): Promise<SessionRow> {
    const session = await this.requireSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
    });
    const existingItem = session.transcript.find((item) => item.id === input.item.id);
    const nextItem = preserveNonTextCreatedAt(existingItem, input.item);
    const nextTranscript = sortSessionTranscript(
      existingItem
        ? session.transcript.map((item) => (item.id === nextItem.id ? nextItem : item))
        : [...session.transcript, nextItem],
    );

    await this.replaceTranscript({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      transcript: nextTranscript,
      title: input.title ?? session.title,
      summary: input.summary ?? session.summary,
      updatedAt:
        input.updatedAt ??
        (input.item.kind === "text" ? input.item.created_at : input.item.updated_at),
    });

    const updated = await this.getById({ tenantId: input.tenantId, sessionId: input.sessionId });
    if (!updated) throw new Error(`session '${input.sessionId}' missing after transcript upsert`);
    return updated;
  }

  async compact(
    input: SessionIdentity & { keepLastMessages: number },
  ): Promise<{ droppedMessages: number; keptMessages: number }> {
    const session = await this.requireSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
    });
    const stored = buildStoredTranscript({
      transcript: session.transcript,
      keepLastMessages: Math.max(0, input.keepLastMessages),
      previousTitle: session.title,
      previousSummary: session.summary,
    });
    await this.writeSession({ tenantId: input.tenantId, sessionId: input.sessionId, stored });
    return {
      droppedMessages: stored.droppedMessages,
      keptMessages: countTextTranscriptItems(stored.transcript),
    };
  }

  async setTitleIfBlank(input: SessionIdentity & { title: string }): Promise<boolean> {
    const title = normalizeSessionTitle(input.title);
    if (!title) return false;
    const result = await this.db.run(
      "UPDATE sessions SET title = ?, updated_at = ? WHERE tenant_id = ? AND session_id = ? AND trim(title) = ''",
      [title, new Date().toISOString(), input.tenantId, input.sessionId],
    );
    return result.changes === 1;
  }

  async repairFromChannelLogs(input: {
    tenantId: string;
    sessionId: string;
    maxTurns?: number;
  }): Promise<SessionRepairResult | null> {
    const session = await this.requireSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
    });
    const rows = await this.db.all<RawChannelTranscriptRow>(REPAIR_SESSION_SQL, [
      input.tenantId,
      input.sessionId,
    ]);
    const rebuiltTranscript: SessionTranscriptItem[] = [];
    let sourceRows = 0;

    for (const row of rows) {
      const parsed = NormalizedThreadMessageSchema.safeParse(safeJsonParse(row.payload_json, {}));
      if (!parsed.success) continue;

      const userMessage = renderNormalizedThreadMessageText(parsed.data);
      if (userMessage.length === 0) continue;

      const assistantMessage =
        row.reply_text !== null
          ? row.reply_text
          : await loadOutboxReplyText(this.db, {
              tenantId: input.tenantId,
              inboxId: row.inbox_id,
            });
      if (assistantMessage === undefined) continue;

      const timestamp = normalizeRepairTimestamp(
        row.processed_at,
        parsed.data.message.envelope?.received_at ?? parsed.data.message.timestamp,
      );
      rebuiltTranscript.push(
        SessionTranscriptTextItem.parse({
          kind: "text",
          id: randomUUID(),
          role: "user",
          content: userMessage,
          created_at: timestamp,
        }),
        SessionTranscriptTextItem.parse({
          kind: "text",
          id: randomUUID(),
          role: "assistant",
          content: assistantMessage,
          created_at: timestamp,
        }),
      );
      sourceRows += 1;
    }

    if (sourceRows === 0) return null;

    const maxTurns = input.maxTurns ?? 0;
    if (maxTurns > 0) {
      const stored = buildStoredTranscript({
        transcript: rebuiltTranscript,
        keepLastMessages: maxTurns * 2,
        previousTitle: session.title,
        previousSummary: session.summary,
      });
      await this.writeSession({
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        stored,
        updatedAt: latestTranscriptTimestamp(stored.transcript) ?? session.updated_at,
      });
      return {
        source_rows: sourceRows,
        rebuilt_messages: rebuiltTranscript.length,
        kept_messages: stored.transcript.length,
        dropped_messages: stored.droppedMessages,
      };
    }

    await this.replaceTranscript({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      transcript: rebuiltTranscript,
      title: session.title,
      summary: session.summary,
      updatedAt: latestTranscriptTimestamp(rebuiltTranscript) ?? session.updated_at,
    });
    return {
      source_rows: sourceRows,
      rebuilt_messages: rebuiltTranscript.length,
      kept_messages: rebuiltTranscript.length,
      dropped_messages: 0,
    };
  }

  async deleteExpired(ttlDays: number, agentKey?: string): Promise<number> {
    const days = Math.floor(ttlDays);
    if (!Number.isFinite(days) || days <= 0) return 0;

    const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
    const tenantId = await this.identityScopeDal.ensureTenantId(DEFAULT_TENANT_KEY);
    const normalizedAgentKey = agentKey?.trim();
    const agentId = normalizedAgentKey
      ? await this.identityScopeDal.ensureAgentId(tenantId, normalizedAgentKey)
      : undefined;
    const agentClause = agentId ? "AND agent_id = ?" : "";
    const params = agentId ? [tenantId, agentId, cutoffIso] : [tenantId, cutoffIso];
    const sql =
      this.db.kind === "sqlite"
        ? `DELETE FROM sessions WHERE tenant_id = ? ${agentClause} AND datetime(replace(replace(updated_at, 'T', ' '), 'Z', '')) < datetime(replace(replace(?, 'T', ' '), 'Z', ''))`
        : `DELETE FROM sessions WHERE tenant_id = ? ${agentClause} AND updated_at < ?`;
    return (await this.db.run(sql, params)).changes;
  }
}
