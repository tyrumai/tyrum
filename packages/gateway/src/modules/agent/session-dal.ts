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
  parsePersistedJson,
  reportPersistedJsonReadFailure,
  stringifyPersistedJson,
  type PersistedJsonObserver,
} from "../observability/persisted-json.js";
import { renderNormalizedThreadMessageText } from "./session-message-text.js";
import { buildAgentTurnKey } from "./turn-key.js";

const logger = new Logger({ base: { module: "agent.session_dal" } });
const SESSION_TURNS_JSON_META = {
  table: "sessions",
  column: "turns_json",
  shape: "array",
} as const;
const UPDATE_SESSION_SQL =
  "UPDATE sessions SET turns_json = ?, summary = ?, updated_at = ? WHERE tenant_id = ? AND session_id = ?";
const REPAIR_SESSION_SQL =
  "SELECT inbox_id, payload_json, reply_text, processed_at FROM channel_inbox WHERE tenant_id = ? AND session_id = ? AND status = 'completed' ORDER BY received_at_ms ASC, inbox_id ASC";
const WITH_DELIVERY_SQL = `SELECT s.*, ag.agent_key, ws.workspace_key, ca.connector_key, ca.account_key, ct.provider_thread_id, ct.container_kind FROM sessions s JOIN agents ag ON ag.tenant_id = s.tenant_id AND ag.agent_id = s.agent_id JOIN workspaces ws ON ws.tenant_id = s.tenant_id AND ws.workspace_id = s.workspace_id JOIN channel_threads ct ON ct.tenant_id = s.tenant_id AND ct.workspace_id = s.workspace_id AND ct.channel_thread_id = s.channel_thread_id JOIN channel_accounts ca ON ca.tenant_id = ct.tenant_id AND ca.workspace_id = ct.workspace_id AND ca.channel_account_id = ct.channel_account_id WHERE s.tenant_id = ? AND s.session_key = ? LIMIT 1`;

type SessionRole = "user" | "assistant";
type SessionPreview = { role: SessionRole; content: string };
type SessionIdentity = { tenantId: string; sessionId: string };
type StoredTranscript = { turns: SessionMessage[]; summary: string; droppedMessages: number };
type RawSessionTimeFields = { created_at: string | Date; updated_at: string | Date };

export interface SessionMessage {
  role: SessionRole;
  content: string;
  timestamp: string;
}
export interface SessionRow extends RawSessionTimeFields {
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
export interface SessionListRow extends RawSessionTimeFields {
  agent_id: string;
  session_id: string;
  channel: string;
  thread_id: string;
  summary: string;
  turns_count: number;
  last_turn: SessionPreview | null;
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
interface RawSessionRow extends RawSessionTimeFields {
  tenant_id: string;
  session_id: string;
  session_key: string;
  agent_id: string;
  workspace_id: string;
  channel_thread_id: string;
  summary: string;
  turns_json: string;
}
interface RawSessionListRow extends RawSessionTimeFields {
  session_id: string;
  session_key: string;
  agent_key: string;
  connector_key: string;
  provider_thread_id: string;
  summary: string;
  turns_json: string;
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

export interface SessionDalOptions extends PersistedJsonObserver {}
export interface SessionRepairResult {
  source_rows: number;
  rebuilt_messages: number;
  kept_messages: number;
  dropped_messages: number;
}

function normalizeTime(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed) && !trimmed.includes("T")
    ? `${trimmed.replace(" ", "T")}Z`
    : value;
}

function isSessionMessage(value: unknown): value is SessionMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record["role"] === "user" || record["role"] === "assistant") &&
    typeof record["content"] === "string" &&
    typeof record["timestamp"] === "string"
  );
}

function isSessionMessageArray(value: unknown): value is SessionMessage[] {
  return Array.isArray(value) && value.every(isSessionMessage);
}

function parseTurns(raw: string, observer: PersistedJsonObserver): SessionMessage[] {
  const parsed = parsePersistedJson<unknown[]>({
    raw,
    fallback: [],
    ...SESSION_TURNS_JSON_META,
    observer,
  });
  const safe = parsed.filter(isSessionMessage);
  const invalidItems = parsed.length - safe.length;
  if (invalidItems > 0)
    reportPersistedJsonReadFailure({
      observer,
      ...SESSION_TURNS_JSON_META,
      reason: "invalid_value",
      extra: { invalid_items: invalidItems },
    });
  return safe;
}

function toSessionRow(raw: RawSessionRow, observer: PersistedJsonObserver): SessionRow {
  return {
    tenant_id: raw.tenant_id,
    session_id: raw.session_id,
    session_key: raw.session_key,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    channel_thread_id: raw.channel_thread_id,
    summary: raw.summary,
    turns: parseTurns(raw.turns_json, observer),
    created_at: normalizeTime(raw.created_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

function normalizeContainerKind(value: string): NormalizedContainerKind {
  return value === "dm" || value === "group" || value === "channel" ? value : "channel";
}

function toSessionListRow(raw: RawSessionListRow, observer: PersistedJsonObserver): SessionListRow {
  const turns = parseTurns(raw.turns_json, observer);
  const lastMessage = turns.at(-1);
  return {
    agent_id: raw.agent_key,
    session_id: raw.session_key,
    channel: raw.connector_key,
    thread_id: raw.provider_thread_id,
    summary: raw.summary,
    turns_count: turns.length,
    last_turn: lastMessage ? { role: lastMessage.role, content: lastMessage.content } : null,
    created_at: normalizeTime(raw.created_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

function trimTo(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 3))}...`;
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
  let lines = [
    ...prevLines,
    ...droppedTurns.map(
      (turn) =>
        `${turn.role === "assistant" ? "A" : "U"} ${turn.timestamp}: ${trimTo(turn.content.trim(), maxLineChars)}`,
    ),
  ];
  if (lines.length > maxLines) lines = lines.slice(lines.length - maxLines);
  while (lines.length > 1 && lines.join("\n").length > maxChars) lines = lines.slice(1);
  return lines.join("\n");
}

function buildStoredTranscript(input: {
  turns: readonly SessionMessage[];
  keepLastMessages: number;
  previousSummary?: string;
}): StoredTranscript {
  const keepLastMessages = Math.max(1, input.keepLastMessages);
  const overflow = input.turns.length - keepLastMessages;
  const dropped = overflow > 0 ? input.turns.slice(0, overflow) : [];
  const turns = input.turns.slice(-keepLastMessages);
  const previousSummary = input.previousSummary ?? "";
  return {
    turns: turns.slice(),
    summary: dropped.length > 0 ? compactSessionSummary(previousSummary, dropped) : previousSummary,
    droppedMessages: dropped.length,
  };
}

function normalizeRepairTimestamp(
  processedAt: string | Date | null,
  fallbackTimestamp: string | undefined,
): string {
  return processedAt
    ? normalizeTime(processedAt)
    : fallbackTimestamp?.trim() || new Date().toISOString();
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
    maxTurns: number;
    timestamp: string;
  }): Promise<SessionRow> {
    const session = await this.requireSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
    });
    const stored = buildStoredTranscript({
      turns: [
        ...session.turns,
        { role: "user", content: input.userMessage, timestamp: input.timestamp },
        { role: "assistant", content: input.assistantMessage, timestamp: input.timestamp },
      ],
      keepLastMessages: Math.max(1, input.maxTurns) * 2,
      previousSummary: session.summary,
    });
    await this.writeSession({ tenantId: input.tenantId, sessionId: input.sessionId, stored });

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
      keepLastMessages: Math.max(2, input.keepLastMessages),
      previousSummary: session.summary,
    });
    await this.writeSession({ tenantId: input.tenantId, sessionId: input.sessionId, stored });
    return { droppedMessages: stored.droppedMessages, keptMessages: stored.turns.length };
  }

  async repairFromChannelLogs(input: {
    tenantId: string;
    sessionId: string;
    maxTurns: number;
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

    const stored = buildStoredTranscript({
      turns: rebuiltTurns,
      keepLastMessages: Math.max(1, input.maxTurns) * 2,
      previousSummary: session.summary,
    });
    await this.writeSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      stored,
      updatedAt: stored.turns.at(-1)?.timestamp ?? session.updated_at,
    });
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
