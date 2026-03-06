import { randomUUID } from "node:crypto";
import { NormalizedThreadMessage as NormalizedThreadMessageSchema } from "@tyrum/schemas";
import type { NormalizedContainerKind } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { safeJsonParse } from "../../utils/json.js";
import { buildAgentTurnKey } from "./turn-key.js";
import type { IdentityScopeDal, ScopeKeys } from "../identity/scope.js";
import { DEFAULT_TENANT_KEY, normalizeScopeKeys } from "../identity/scope.js";
import { ChannelThreadDal } from "../channels/thread-dal.js";
import {
  DEFAULT_CHANNEL_ACCOUNT_ID,
  normalizeAccountId,
  normalizeConnectorId,
} from "../channels/interface.js";
import { renderNormalizedThreadMessageText } from "./session-message-text.js";
import { Logger } from "../observability/logger.js";

const logger = new Logger({ base: { module: "agent.session_dal" } });
let warnedTurnsJsonParse = false;

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface SessionRow {
  tenant_id: string;
  session_id: string;
  session_key: string;
  agent_id: string;
  workspace_id: string;
  channel_thread_id: string;
  summary: string;
  turns: SessionMessage[];
  created_at: string;
  updated_at: string;
}

export interface SessionListRow {
  agent_id: string;
  session_id: string;
  channel: string;
  thread_id: string;
  summary: string;
  turns_count: number;
  last_turn: { role: "user" | "assistant"; content: string } | null;
  created_at: string;
  updated_at: string;
}

export type SessionWithDelivery = {
  session: SessionRow;
  agent_key: string;
  workspace_key: string;
  connector_key: string;
  account_key: string;
  provider_thread_id: string;
  container_kind: NormalizedContainerKind;
};

interface RawSessionRow {
  tenant_id: string;
  session_id: string;
  session_key: string;
  agent_id: string;
  workspace_id: string;
  channel_thread_id: string;
  summary: string;
  turns_json: string;
  created_at: string | Date;
  updated_at: string | Date;
}

interface RawSessionListRow {
  session_id: string;
  session_key: string;
  agent_key: string;
  connector_key: string;
  provider_thread_id: string;
  summary: string;
  turns_count: number | string;
  last_turn_role: string | null;
  last_turn_content: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface RawSessionWithDeliveryRow extends RawSessionRow {
  agent_key: string;
  workspace_key: string;
  connector_key: string;
  account_key: string;
  provider_thread_id: string;
  container_kind: string;
}

interface RawChannelTranscriptRow {
  inbox_id: number;
  payload_json: string;
  reply_text: string | null;
  processed_at: string | Date | null;
}

export interface SessionRepairResult {
  source_rows: number;
  rebuilt_messages: number;
  kept_messages: number;
  dropped_messages: number;
}

function normalizeTime(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed) && !trimmed.includes("T")) {
    return trimmed.replace(" ", "T") + "Z";
  }

  return value;
}

function parseTurns(raw: string): SessionMessage[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const safe: SessionMessage[] = [];
    for (const entry of parsed) {
      if (
        entry &&
        typeof entry === "object" &&
        ((entry as Record<string, unknown>)["role"] === "user" ||
          (entry as Record<string, unknown>)["role"] === "assistant") &&
        typeof (entry as Record<string, unknown>)["content"] === "string" &&
        typeof (entry as Record<string, unknown>)["timestamp"] === "string"
      ) {
        safe.push({
          role: (entry as Record<string, unknown>)["role"] as "user" | "assistant",
          content: (entry as Record<string, unknown>)["content"] as string,
          timestamp: (entry as Record<string, unknown>)["timestamp"] as string,
        });
      }
    }
    return safe;
  } catch (err) {
    if (!warnedTurnsJsonParse) {
      warnedTurnsJsonParse = true;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("sessions.turns_json_parse_failed", { error: message });
    }
    return [];
  }
}

function toSessionRow(raw: RawSessionRow): SessionRow {
  return {
    tenant_id: raw.tenant_id,
    session_id: raw.session_id,
    session_key: raw.session_key,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    channel_thread_id: raw.channel_thread_id,
    summary: raw.summary,
    turns: parseTurns(raw.turns_json),
    created_at: normalizeTime(raw.created_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

function normalizeContainerKind(value: string): NormalizedContainerKind {
  if (value === "dm" || value === "group" || value === "channel") return value;
  return "channel";
}

function asNumber(value: number | string): number {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toSessionListRow(raw: RawSessionListRow): SessionListRow {
  const createdAt = normalizeTime(raw.created_at);
  const updatedAt = normalizeTime(raw.updated_at);
  const turnsCount = asNumber(raw.turns_count);

  const role = raw.last_turn_role;
  const content = raw.last_turn_content;
  let lastTurn: { role: "user" | "assistant"; content: string } | null = null;
  if ((role === "user" || role === "assistant") && typeof content === "string") {
    lastTurn = { role, content };
  }

  return {
    agent_id: raw.agent_key,
    session_id: raw.session_key,
    channel: raw.connector_key,
    thread_id: raw.provider_thread_id,
    summary: raw.summary,
    turns_count: turnsCount,
    last_turn: lastTurn,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function trimTo(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function compactSessionSummary(
  previousSummary: string,
  droppedTurns: readonly SessionMessage[],
  opts?: { maxLines?: number; maxChars?: number; maxLineChars?: number },
): string {
  const maxLines = Math.max(10, opts?.maxLines ?? 200);
  const maxChars = Math.max(200, opts?.maxChars ?? 6000);
  const maxLineChars = Math.max(40, opts?.maxLineChars ?? 240);

  const prevLines = previousSummary.trim().length > 0 ? previousSummary.trim().split("\n") : [];

  const newLines = droppedTurns.map((turn) => {
    const role = turn.role === "assistant" ? "A" : "U";
    const content = trimTo(turn.content.trim(), maxLineChars);
    return `${role} ${turn.timestamp}: ${content}`;
  });

  let lines = [...prevLines, ...newLines];
  if (lines.length > maxLines) {
    lines = lines.slice(lines.length - maxLines);
  }

  while (lines.length > 1 && lines.join("\n").length > maxChars) {
    lines = lines.slice(1);
  }

  return lines.join("\n");
}

function buildStoredTranscript(input: {
  turns: readonly SessionMessage[];
  keepLastMessages: number;
  previousSummary?: string;
}): { turns: SessionMessage[]; summary: string; droppedMessages: number } {
  const keepLastMessages = Math.max(1, input.keepLastMessages);
  const overflow = input.turns.length - keepLastMessages;
  const dropped = overflow > 0 ? input.turns.slice(0, overflow) : [];
  const turns = input.turns.slice(-keepLastMessages);
  const previousSummary = input.previousSummary ?? "";
  const summary =
    dropped.length > 0 ? compactSessionSummary(previousSummary, dropped) : previousSummary;

  return {
    turns: turns.slice(),
    summary,
    droppedMessages: dropped.length,
  };
}

function normalizeRepairTimestamp(
  processedAt: string | Date | null,
  fallbackTimestamp: string | undefined,
): string {
  if (processedAt) return normalizeTime(processedAt);
  return fallbackTimestamp?.trim() || new Date().toISOString();
}

export class SessionDal {
  constructor(
    private readonly db: SqlDb,
    private readonly identityScopeDal: IdentityScopeDal,
    private readonly channelThreadDal: ChannelThreadDal,
  ) {}

  private static encodeCursor(input: { updated_at: string; session_id: string }): string {
    const payload = { updated_at: input.updated_at, session_id: input.session_id };
    return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  }

  private static decodeCursor(
    cursor: string,
  ): { updated_at: string; session_id: string } | undefined {
    const trimmed = cursor.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(Buffer.from(trimmed, "base64url").toString("utf-8")) as unknown;
      if (!parsed || typeof parsed !== "object") return undefined;
      const updatedAt = (parsed as Record<string, unknown>)["updated_at"];
      const sessionId = (parsed as Record<string, unknown>)["session_id"];
      if (typeof updatedAt !== "string" || updatedAt.trim().length === 0) return undefined;
      if (typeof sessionId !== "string" || sessionId.trim().length === 0) return undefined;
      return { updated_at: updatedAt, session_id: sessionId };
    } catch {
      // Intentional: treat any cursor decode failures as an invalid cursor.
      return undefined;
    }
  }

  async getById(input: { tenantId: string; sessionId: string }): Promise<SessionRow | undefined> {
    const row = await this.db.get<RawSessionRow>(
      `SELECT *
       FROM sessions
       WHERE tenant_id = ?
         AND session_id = ?
       LIMIT 1`,
      [input.tenantId, input.sessionId],
    );
    return row ? toSessionRow(row) : undefined;
  }

  async getByKey(input: { tenantId: string; sessionKey: string }): Promise<SessionRow | undefined> {
    const row = await this.db.get<RawSessionRow>(
      `SELECT *
       FROM sessions
       WHERE tenant_id = ?
         AND session_key = ?
       LIMIT 1`,
      [input.tenantId, input.sessionKey],
    );
    return row ? toSessionRow(row) : undefined;
  }

  async getWithDeliveryByKey(input: {
    tenantId: string;
    sessionKey: string;
  }): Promise<SessionWithDelivery | undefined> {
    const row = await this.db.get<RawSessionWithDeliveryRow>(
      `SELECT
         s.*,
         ag.agent_key,
         ws.workspace_key,
         ca.connector_key,
         ca.account_key,
         ct.provider_thread_id,
         ct.container_kind
       FROM sessions s
       JOIN agents ag
         ON ag.tenant_id = s.tenant_id
        AND ag.agent_id = s.agent_id
       JOIN workspaces ws
         ON ws.tenant_id = s.tenant_id
        AND ws.workspace_id = s.workspace_id
       JOIN channel_threads ct
         ON ct.tenant_id = s.tenant_id
        AND ct.workspace_id = s.workspace_id
        AND ct.channel_thread_id = s.channel_thread_id
       JOIN channel_accounts ca
         ON ca.tenant_id = ct.tenant_id
        AND ca.workspace_id = ct.workspace_id
        AND ca.channel_account_id = ct.channel_account_id
       WHERE s.tenant_id = ?
         AND s.session_key = ?
       LIMIT 1`,
      [input.tenantId, input.sessionKey],
    );
    if (!row) return undefined;
    return {
      session: toSessionRow(row),
      agent_key: row.agent_key,
      workspace_key: row.workspace_key,
      connector_key: row.connector_key,
      account_key: row.account_key,
      provider_thread_id: row.provider_thread_id,
      container_kind: normalizeContainerKind(row.container_kind),
    };
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
      `INSERT INTO sessions (
         tenant_id,
         session_id,
         session_key,
         agent_id,
         workspace_id,
         channel_thread_id,
         summary,
         turns_json,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, '', '[]', ?, ?)
       ON CONFLICT (tenant_id, session_key) DO NOTHING
      RETURNING *`,
      [tenantId, randomUUID(), sessionKey, agentId, workspaceId, channelThreadId, nowIso, nowIso],
    );
    if (inserted) return toSessionRow(inserted);

    const created = await this.getByKey({ tenantId, sessionKey });
    if (!created) {
      throw new Error("failed to create session");
    }
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
    if (input.cursor && !cursor) {
      throw new Error("invalid cursor");
    }

    const where: string[] = ["s.tenant_id = ?", "s.agent_id = ?", "s.workspace_id = ?"];
    const params: unknown[] = [scopeIds.tenantId, scopeIds.agentId, scopeIds.workspaceId];

    if (connectorKey) {
      where.push("ca.connector_key = ?");
      params.push(connectorKey);
    }

    if (cursor) {
      where.push("(s.updated_at < ? OR (s.updated_at = ? AND s.session_id < ?))");
      params.push(cursor.updated_at, cursor.updated_at, cursor.session_id);
    }

    const listSql =
      this.db.kind === "sqlite"
        ? `SELECT
             s.session_id,
             s.session_key,
             ag.agent_key,
             ca.connector_key,
             ct.provider_thread_id,
             s.summary,
             s.created_at,
             s.updated_at,
             CASE
               WHEN json_valid(s.turns_json)
                 THEN json_array_length(s.turns_json)
               ELSE 0
             END AS turns_count,
             CASE
               WHEN json_valid(s.turns_json)
                 THEN json_extract(s.turns_json, '$[#-1].role')
               ELSE NULL
             END AS last_turn_role,
             CASE
               WHEN json_valid(s.turns_json)
                 THEN json_extract(s.turns_json, '$[#-1].content')
               ELSE NULL
             END AS last_turn_content
           FROM sessions s
           JOIN agents ag
             ON ag.tenant_id = s.tenant_id
            AND ag.agent_id = s.agent_id
           JOIN channel_threads ct
             ON ct.tenant_id = s.tenant_id
            AND ct.workspace_id = s.workspace_id
            AND ct.channel_thread_id = s.channel_thread_id
           JOIN channel_accounts ca
             ON ca.tenant_id = ct.tenant_id
            AND ca.workspace_id = ct.workspace_id
            AND ca.channel_account_id = ct.channel_account_id
           WHERE ${where.join(" AND ")}
           ORDER BY s.updated_at DESC, s.session_id DESC
           LIMIT ?`
        : `SELECT
             session_id,
             session_key,
             agent_key,
             connector_key,
             provider_thread_id,
             summary,
             created_at,
             updated_at,
             CASE
               WHEN jsonb_typeof(turns) = 'array' THEN jsonb_array_length(turns)
               ELSE 0
             END AS turns_count,
             (turns -> -1 ->> 'role') AS last_turn_role,
             (turns -> -1 ->> 'content') AS last_turn_content
           FROM (
             SELECT
               s.session_id,
               s.session_key,
               ag.agent_key,
               ca.connector_key,
               ct.provider_thread_id,
               s.summary,
               s.created_at,
               s.updated_at,
               CASE
                 WHEN pg_input_is_valid(s.turns_json, 'jsonb') THEN s.turns_json::jsonb
                 ELSE '[]'::jsonb
               END AS turns
             FROM sessions s
             JOIN agents ag
               ON ag.tenant_id = s.tenant_id
              AND ag.agent_id = s.agent_id
             JOIN channel_threads ct
               ON ct.tenant_id = s.tenant_id
              AND ct.workspace_id = s.workspace_id
              AND ct.channel_thread_id = s.channel_thread_id
             JOIN channel_accounts ca
               ON ca.tenant_id = ct.tenant_id
              AND ca.workspace_id = ct.workspace_id
              AND ca.channel_account_id = ct.channel_account_id
             WHERE ${where.join(" AND ")}
           ) sessions_with_turns
           ORDER BY updated_at DESC, session_id DESC
           LIMIT ?`;

    const rows = await this.db.all<RawSessionListRow>(listSql, [...params, limit + 1]);
    const selectedRows = rows.slice(0, limit);
    const sessions = selectedRows.map(toSessionListRow);

    const hasMore = rows.length > limit;
    const last = selectedRows.at(-1);

    return {
      sessions,
      nextCursor:
        hasMore && last
          ? SessionDal.encodeCursor({
              updated_at: normalizeTime(last.updated_at),
              session_id: last.session_id,
            })
          : null,
    };
  }

  async reset(input: { tenantId: string; sessionId: string }): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const res = await this.db.run(
      `UPDATE sessions
       SET turns_json = '[]', summary = '', updated_at = ?
       WHERE tenant_id = ? AND session_id = ?`,
      [nowIso, input.tenantId, input.sessionId],
    );
    return res.changes === 1;
  }

  async appendTurn(input: {
    tenantId: string;
    sessionId: string;
    userMessage: string;
    assistantMessage: string;
    maxTurns: number;
    timestamp: string;
  }): Promise<SessionRow> {
    const session = await this.getById({ tenantId: input.tenantId, sessionId: input.sessionId });
    if (!session) {
      throw new Error(`session '${input.sessionId}' not found`);
    }

    const turns = session.turns.slice();
    turns.push({
      role: "user",
      content: input.userMessage,
      timestamp: input.timestamp,
    });
    turns.push({
      role: "assistant",
      content: input.assistantMessage,
      timestamp: input.timestamp,
    });

    const stored = buildStoredTranscript({
      turns,
      keepLastMessages: Math.max(1, input.maxTurns) * 2,
      previousSummary: session.summary,
    });

    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE sessions
       SET turns_json = ?, summary = ?, updated_at = ?
       WHERE tenant_id = ? AND session_id = ?`,
      [JSON.stringify(stored.turns), stored.summary, nowIso, input.tenantId, input.sessionId],
    );

    const updated = await this.getById({ tenantId: input.tenantId, sessionId: input.sessionId });
    if (!updated) {
      throw new Error(`session '${input.sessionId}' missing after update`);
    }
    return updated;
  }

  async compact(input: {
    tenantId: string;
    sessionId: string;
    keepLastMessages: number;
  }): Promise<{ droppedMessages: number; keptMessages: number }> {
    const session = await this.getById({ tenantId: input.tenantId, sessionId: input.sessionId });
    if (!session) {
      throw new Error(`session '${input.sessionId}' not found`);
    }

    const keepLastMessages = Math.max(2, input.keepLastMessages);
    const stored = buildStoredTranscript({
      turns: session.turns,
      keepLastMessages,
      previousSummary: session.summary,
    });

    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE sessions
       SET turns_json = ?, summary = ?, updated_at = ?
       WHERE tenant_id = ? AND session_id = ?`,
      [JSON.stringify(stored.turns), stored.summary, nowIso, input.tenantId, input.sessionId],
    );

    return { droppedMessages: stored.droppedMessages, keptMessages: stored.turns.length };
  }

  async repairFromChannelLogs(input: {
    tenantId: string;
    sessionId: string;
    maxTurns: number;
  }): Promise<SessionRepairResult | null> {
    const session = await this.getById({ tenantId: input.tenantId, sessionId: input.sessionId });
    if (!session) {
      throw new Error(`session '${input.sessionId}' not found`);
    }

    const rows = await this.db.all<RawChannelTranscriptRow>(
      `SELECT inbox_id, payload_json, reply_text, processed_at
       FROM channel_inbox
       WHERE tenant_id = ?
         AND session_id = ?
         AND status = 'completed'
       ORDER BY received_at_ms ASC, inbox_id ASC`,
      [input.tenantId, input.sessionId],
    );

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
          : await this.loadOutboxReplyText({
              tenantId: input.tenantId,
              inboxId: row.inbox_id,
            });
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

    const stored = buildStoredTranscript({
      turns: rebuiltTurns,
      keepLastMessages: Math.max(1, input.maxTurns) * 2,
      previousSummary: session.summary,
    });
    const updatedAt = stored.turns.at(-1)?.timestamp ?? session.updated_at;

    await this.db.run(
      `UPDATE sessions
       SET turns_json = ?, summary = ?, updated_at = ?
       WHERE tenant_id = ? AND session_id = ?`,
      [JSON.stringify(stored.turns), stored.summary, updatedAt, input.tenantId, input.sessionId],
    );

    return {
      source_rows: sourceRows,
      rebuilt_messages: rebuiltTurns.length,
      kept_messages: stored.turns.length,
      dropped_messages: stored.droppedMessages,
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

    if (this.db.kind === "sqlite") {
      const res = await this.db.run(
        `DELETE FROM sessions
         WHERE tenant_id = ?
           ${agentId ? "AND agent_id = ?" : ""}
           AND datetime(replace(replace(updated_at, 'T', ' '), 'Z', '')) < datetime(replace(replace(?, 'T', ' '), 'Z', ''))`,
        agentId ? [tenantId, agentId, cutoffIso] : [tenantId, cutoffIso],
      );
      return res.changes;
    }

    const res = await this.db.run(
      `DELETE FROM sessions
       WHERE tenant_id = ?
         ${agentId ? "AND agent_id = ?" : ""}
         AND updated_at < ?`,
      agentId ? [tenantId, agentId, cutoffIso] : [tenantId, cutoffIso],
    );
    return res.changes;
  }

  private async loadOutboxReplyText(input: {
    tenantId: string;
    inboxId: number;
  }): Promise<string | undefined> {
    const rows = await this.db.all<{ text: string }>(
      `SELECT text
       FROM channel_outbox
       WHERE tenant_id = ? AND inbox_id = ?
       ORDER BY chunk_index ASC, outbox_id ASC`,
      [input.tenantId, input.inboxId],
    );
    if (rows.length === 0) return undefined;
    return rows.map((row) => row.text).join("");
  }
}
