import { randomUUID } from "node:crypto";
import { NormalizedThreadMessage as NormalizedThreadMessageSchema } from "@tyrum/schemas";
import type { NormalizedContainerKind } from "@tyrum/schemas";
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
import {
  stringifyPersistedJson,
  type PersistedJsonObserver,
} from "../observability/persisted-json.js";
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
  SessionMessage,
  SessionRepairResult,
  SessionRow,
  SessionWithDelivery,
  StoredTranscript,
} from "./session-dal-helpers.js";
import {
  buildStoredTranscript,
  isSessionMessageArray,
  normalizeContainerKind,
  normalizeRepairTimestamp,
  normalizeTime,
  REPAIR_SESSION_SQL,
  SESSION_TURNS_JSON_META,
  toSessionListRow,
  toSessionRow,
  UPDATE_SESSION_SQL,
  WITH_DELIVERY_SQL,
} from "./session-dal-helpers.js";
export type {
  SessionMessage,
  SessionRow,
  SessionListRow,
  SessionWithDelivery,
  SessionDalOptions,
  SessionRepairResult,
} from "./session-dal-helpers.js";

const logger = new Logger({ base: { module: "agent.session_dal" } });

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

  private static encodeCursor(input: { updated_at: string; session_id: string }): string {
    return Buffer.from(
      JSON.stringify({ updated_at: input.updated_at, session_id: input.session_id }),
      "utf-8",
    ).toString("base64url");
  }

  private static decodeCursor(
    cursor: string,
  ): { updated_at: string; session_id: string } | undefined {
    const trimmed = cursor.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(Buffer.from(trimmed, "base64url").toString("utf-8")) as unknown;
      if (!parsed || typeof parsed !== "object") return undefined;
      const { updated_at: updatedAt, session_id: sessionId } = parsed as Record<string, unknown>;
      return typeof updatedAt === "string" &&
        updatedAt.trim().length > 0 &&
        typeof sessionId === "string" &&
        sessionId.trim().length > 0
        ? { updated_at: updatedAt, session_id: sessionId }
        : undefined;
    } catch {
      // Intentional: invalid cursors are treated as absent.
      return undefined;
    }
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

  private stringifyTurns(turns: SessionMessage[]): string {
    return stringifyPersistedJson({
      value: turns,
      ...SESSION_TURNS_JSON_META,
      validate: isSessionMessageArray,
    });
  }

  private async writeSession(
    input: SessionIdentity & { stored: StoredTranscript; updatedAt?: string },
  ): Promise<void> {
    await this.db.run(UPDATE_SESSION_SQL, [
      this.stringifyTurns(input.stored.turns),
      input.stored.summary,
      input.updatedAt ?? new Date().toISOString(),
      input.tenantId,
      input.sessionId,
    ]);
  }

  async replaceTranscript(
    input: SessionIdentity & {
      turns: SessionMessage[];
      summary: string;
      updatedAt?: string;
    },
  ): Promise<void> {
    await this.writeSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      updatedAt: input.updatedAt,
      stored: {
        turns: input.turns,
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
      "INSERT INTO sessions (tenant_id, session_id, session_key, agent_id, workspace_id, channel_thread_id, summary, turns_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '', '[]', ?, ?) ON CONFLICT (tenant_id, session_key) DO NOTHING RETURNING *",
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
    const cursor = input.cursor ? SessionDal.decodeCursor(input.cursor) : undefined;
    if (input.cursor && !cursor) throw new Error("invalid cursor");

    const where = ["s.tenant_id = ?", "s.agent_id = ?", "s.workspace_id = ?"];
    const params: unknown[] = [scopeIds.tenantId, scopeIds.agentId, scopeIds.workspaceId];
    if (connectorKey) {
      where.push("ca.connector_key = ?");
      params.push(connectorKey);
    }
    if (cursor) {
      where.push("(s.updated_at < ? OR (s.updated_at = ? AND s.session_id < ?))");
      params.push(cursor.updated_at, cursor.updated_at, cursor.session_id);
    }

    const rows = await this.db.all<RawSessionListRow>(
      `SELECT s.session_id, s.session_key, ag.agent_key, ca.connector_key, ct.provider_thread_id, s.summary, s.turns_json, s.created_at, s.updated_at FROM sessions s JOIN agents ag ON ag.tenant_id = s.tenant_id AND ag.agent_id = s.agent_id JOIN channel_threads ct ON ct.tenant_id = s.tenant_id AND ct.workspace_id = s.workspace_id AND ct.channel_thread_id = s.channel_thread_id JOIN channel_accounts ca ON ca.tenant_id = ct.tenant_id AND ca.workspace_id = ct.workspace_id AND ca.channel_account_id = ct.channel_account_id WHERE ${where.join(" AND ")} ORDER BY s.updated_at DESC, s.session_id DESC LIMIT ?`,
      [...params, limit + 1],
    );
    const selectedRows = rows.slice(0, limit);
    const last = selectedRows.at(-1);
    return {
      sessions: selectedRows.map((row) => toSessionListRow(row, this.jsonObserver)),
      nextCursor:
        rows.length > limit && last
          ? SessionDal.encodeCursor({
              updated_at: normalizeTime(last.updated_at),
              session_id: last.session_id,
            })
          : null,
    };
  }

  async reset(input: SessionIdentity): Promise<boolean> {
    const res = await this.db.run(
      "UPDATE sessions SET turns_json = '[]', summary = '', updated_at = ? WHERE tenant_id = ? AND session_id = ?",
      [new Date().toISOString(), input.tenantId, input.sessionId],
    );
    return res.changes === 1;
  }

  async appendTurn(input: {
    tenantId: string;
    sessionId: string;
    userMessage: string;
    assistantMessage: string;
    timestamp: string;
  }): Promise<SessionRow> {
    const session = await this.requireSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
    });
    await this.replaceTranscript({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      turns: [
        ...session.turns,
        { role: "user", content: input.userMessage, timestamp: input.timestamp },
        { role: "assistant", content: input.assistantMessage, timestamp: input.timestamp },
      ],
      summary: session.summary,
      updatedAt: input.timestamp,
    });

    const updated = await this.getById({ tenantId: input.tenantId, sessionId: input.sessionId });
    if (!updated) throw new Error(`session '${input.sessionId}' missing after update`);
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
      turns: session.turns,
      keepLastMessages: Math.max(0, input.keepLastMessages),
      previousSummary: session.summary,
    });
    await this.writeSession({ tenantId: input.tenantId, sessionId: input.sessionId, stored });
    return { droppedMessages: stored.droppedMessages, keptMessages: stored.turns.length };
  }

  async repairFromChannelLogs(input: {
    tenantId: string;
    sessionId: string;
  }): Promise<SessionRepairResult | null> {
    const session = await this.requireSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
    });
    const rows = await this.db.all<RawChannelTranscriptRow>(REPAIR_SESSION_SQL, [
      input.tenantId,
      input.sessionId,
    ]);
    const rebuiltTurns: SessionMessage[] = [];
    let sourceRows = 0;

    for (const row of rows) {
      const parsed = NormalizedThreadMessageSchema.safeParse(safeJsonParse(row.payload_json, {}));
      if (!parsed.success) continue;

      const userMessage = renderNormalizedThreadMessageText(parsed.data);
      if (userMessage.length === 0) continue;

      const assistantMessage =
        row.reply_text !== null
          ? row.reply_text
          : await this.loadOutboxReplyText({ tenantId: input.tenantId, inboxId: row.inbox_id });
      if (assistantMessage === undefined) continue;

      const timestamp = normalizeRepairTimestamp(
        row.processed_at,
        parsed.data.message.envelope?.received_at ?? parsed.data.message.timestamp,
      );
      rebuiltTurns.push(
        { role: "user", content: userMessage, timestamp },
        { role: "assistant", content: assistantMessage, timestamp },
      );
      sourceRows += 1;
    }

    if (sourceRows === 0) return null;

    await this.replaceTranscript({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      turns: rebuiltTurns,
      summary: session.summary,
      updatedAt: rebuiltTurns.at(-1)?.timestamp ?? session.updated_at,
    });
    return {
      source_rows: sourceRows,
      rebuilt_messages: rebuiltTurns.length,
      kept_messages: rebuiltTurns.length,
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

  private async loadOutboxReplyText(input: {
    tenantId: string;
    inboxId: number;
  }): Promise<string | undefined> {
    const rows = await this.db.all<{ text: string }>(
      "SELECT text FROM channel_outbox WHERE tenant_id = ? AND inbox_id = ? ORDER BY chunk_index ASC, outbox_id ASC",
      [input.tenantId, input.inboxId],
    );
    return rows.length > 0 ? rows.map((row) => row.text).join("") : undefined;
  }
}
