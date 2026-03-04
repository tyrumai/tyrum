import { randomUUID } from "node:crypto";
import type { NormalizedContainerKind } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { buildAgentTurnKey } from "./turn-key.js";
import type { IdentityScopeDal, ScopeKeys } from "../identity/scope.js";
import { DEFAULT_TENANT_KEY, normalizeScopeKeys } from "../identity/scope.js";
import { ChannelThreadDal } from "../channels/thread-dal.js";
import {
  DEFAULT_CHANNEL_ACCOUNT_ID,
  normalizeAccountId,
  normalizeConnectorId,
} from "../channels/interface.js";
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

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
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

export class SessionDal {
  constructor(
    private readonly db: SqlDb,
    private readonly identityScopeDal: IdentityScopeDal,
    private readonly channelThreadDal: ChannelThreadDal,
  ) {}

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

  async getOrCreate(input: {
    scopeKeys?: Partial<ScopeKeys>;
    connectorKey: string;
    accountKey?: string;
    providerThreadId: string;
    containerKind: NormalizedContainerKind;
  }): Promise<SessionRow> {
    const keys = normalizeScopeKeys(input.scopeKeys);
    const scopeIds = await this.identityScopeDal.resolveScopeIds(keys);

    const connectorKey = normalizeConnectorId(input.connectorKey);
    const accountKey = normalizeAccountId(input.accountKey);

    const channelAccountId = await this.channelThreadDal.ensureChannelAccountId({
      tenantId: scopeIds.tenantId,
      workspaceId: scopeIds.workspaceId,
      connectorKey,
      accountKey,
    });
    const channelThreadId = await this.channelThreadDal.ensureChannelThreadId({
      tenantId: scopeIds.tenantId,
      workspaceId: scopeIds.workspaceId,
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

    const existing = await this.getByKey({ tenantId: scopeIds.tenantId, sessionKey });
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
      [
        scopeIds.tenantId,
        randomUUID(),
        sessionKey,
        scopeIds.agentId,
        scopeIds.workspaceId,
        channelThreadId,
        nowIso,
        nowIso,
      ],
    );
    if (inserted) return toSessionRow(inserted);

    const created = await this.getByKey({ tenantId: scopeIds.tenantId, sessionKey });
    if (!created) {
      throw new Error("failed to create session");
    }
    return created;
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

    const maxMessages = Math.max(1, input.maxTurns) * 2;
    const overflow = turns.length - maxMessages;
    const dropped = overflow > 0 ? turns.slice(0, overflow) : [];
    const bounded = turns.slice(-maxMessages);
    const summary =
      dropped.length > 0 ? compactSessionSummary(session.summary, dropped) : session.summary;

    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE sessions
       SET turns_json = ?, summary = ?, updated_at = ?
       WHERE tenant_id = ? AND session_id = ?`,
      [JSON.stringify(bounded), summary, nowIso, input.tenantId, input.sessionId],
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
    const overflow = session.turns.length - keepLastMessages;
    const dropped = overflow > 0 ? session.turns.slice(0, overflow) : [];
    const bounded = session.turns.slice(-keepLastMessages);
    const summary =
      dropped.length > 0 ? compactSessionSummary(session.summary, dropped) : session.summary;

    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE sessions
       SET turns_json = ?, summary = ?, updated_at = ?
       WHERE tenant_id = ? AND session_id = ?`,
      [JSON.stringify(bounded), summary, nowIso, input.tenantId, input.sessionId],
    );

    return { droppedMessages: dropped.length, keptMessages: bounded.length };
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
}
