import { randomUUID } from "node:crypto";
import type { TyrumUIMessage, NormalizedContainerKind } from "@tyrum/contracts";
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
import { buildAgentTurnKey } from "./turn-key.js";
import type {
  ConversationState,
  RawSessionListRow,
  RawSessionRow,
  RawSessionWithDeliveryRow,
  SessionDalOptions,
  SessionIdentity,
  SessionListRow,
  SessionRow,
  SessionWithDelivery,
} from "./session-dal-helpers.js";
import {
  createEmptySessionContextState,
  normalizeContainerKind,
  normalizeSessionTitle,
  normalizeTime,
  toSessionListRow,
  toSessionRow,
  UPDATE_SESSION_SQL,
  WITH_DELIVERY_SQL,
} from "./session-dal-helpers.js";
import {
  buildSessionListWhereClause,
  createSessionContextStateForMessages,
  decodeSessionCursor,
  encodeSessionCursor,
  stringifySessionContextState,
  stringifySessionMessages,
} from "./session-dal-runtime.js";
import { buildDeterministicFallbackCheckpoint } from "./runtime/session-compaction-fallback.js";
import {
  collectPendingApprovals,
  collectPendingToolStates,
  extractCriticalIdentifiers,
  extractRelevantFiles,
  splitMessagesForContextCompaction,
} from "./runtime/session-context-state.js";
import {
  createTextMessage,
  deleteExpiredSessions,
  resetSessionContent,
  setSessionTitleIfBlank,
} from "./session-dal-message-helpers.js";
import { replaceSessionArtifactLinksTx } from "../artifact/dal.js";
import { insertArtifactRecordTx } from "../artifact/dal.js";
import type { ArtifactRecordInsertInput } from "../artifact/dal.js";

export type {
  ConversationState,
  SessionRow,
  SessionListRow,
  SessionWithDelivery,
  SessionDalOptions,
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

  private async writeSession(input: {
    tenantId: string;
    sessionId: string;
    messages: TyrumUIMessage[];
    title: string;
    contextState?: ConversationState;
    updatedAt?: string;
  }): Promise<void> {
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    const contextState = input.contextState
      ? { ...input.contextState, updated_at: updatedAt }
      : createSessionContextStateForMessages(input.messages, updatedAt);
    await this.db.run(UPDATE_SESSION_SQL, [
      stringifySessionMessages(input.messages),
      stringifySessionContextState(contextState),
      input.title,
      updatedAt,
      input.tenantId,
      input.sessionId,
    ]);
  }

  async replaceMessages(
    input: SessionIdentity & {
      messages: TyrumUIMessage[];
      updatedAt?: string;
      artifactRecords?: readonly ArtifactRecordInsertInput[];
    },
  ): Promise<void> {
    const session = await this.requireSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
    });
    await this.db.transaction(async (tx) => {
      const updatedAt = input.updatedAt ?? new Date().toISOString();
      const contextState = createSessionContextStateForMessages(
        input.messages,
        updatedAt,
        session.context_state,
      );
      await tx.run(UPDATE_SESSION_SQL, [
        stringifySessionMessages(input.messages),
        stringifySessionContextState(contextState),
        session.title,
        updatedAt,
        input.tenantId,
        input.sessionId,
      ]);
      for (const artifactRecord of input.artifactRecords ?? []) {
        await insertArtifactRecordTx(tx, artifactRecord);
      }
      await replaceSessionArtifactLinksTx(tx, {
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        previousMessages: session.messages,
        nextMessages: input.messages,
      });
    });
  }

  async replaceContextState(
    input: SessionIdentity & {
      contextState: ConversationState;
      updatedAt?: string;
    },
  ): Promise<void> {
    const session = await this.requireSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
    });
    await this.writeSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      messages: session.messages,
      title: session.title,
      contextState: input.contextState,
      updatedAt: input.updatedAt,
    });
  }

  async compact(
    input: SessionIdentity & { keepLastMessages: number; updatedAt?: string },
  ): Promise<{ droppedMessages: number; keptMessages: number; summary: string }> {
    const session = await this.requireSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
    });
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    const { dropped, kept } = splitMessagesForContextCompaction({
      messages: session.messages,
      keepLastMessages: input.keepLastMessages,
    });
    if (dropped.length === 0) {
      return {
        droppedMessages: 0,
        keptMessages: kept.length,
        summary: session.context_state.checkpoint?.handoff_md ?? "",
      };
    }
    const criticalIdentifiers = extractCriticalIdentifiers(dropped);
    const checkpoint = buildDeterministicFallbackCheckpoint({
      previousCheckpoint: session.context_state.checkpoint,
      droppedMessages: dropped,
      criticalIdentifiers,
      relevantFiles: extractRelevantFiles(criticalIdentifiers),
    });
    const contextState = {
      ...session.context_state,
      compacted_through_message_id: dropped.at(-1)?.id,
      recent_message_ids: kept.map((message) => message.id),
      checkpoint,
      pending_approvals: collectPendingApprovals(session.messages),
      pending_tool_state: collectPendingToolStates(session.messages),
      updated_at: updatedAt,
    };
    await this.replaceContextState({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      contextState,
      updatedAt,
    });
    return {
      droppedMessages: dropped.length,
      keptMessages: kept.length,
      summary: checkpoint.handoff_md,
    };
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
      "INSERT INTO sessions (tenant_id, session_id, session_key, agent_id, workspace_id, channel_thread_id, title, messages_json, context_state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '', '[]', ?, ?, ?) ON CONFLICT (tenant_id, session_key) DO NOTHING RETURNING *",
      [
        tenantId,
        randomUUID(),
        sessionKey,
        agentId,
        workspaceId,
        channelThreadId,
        stringifySessionContextState(createEmptySessionContextState(nowIso)),
        nowIso,
        nowIso,
      ],
    );
    if (inserted) return toSessionRow(inserted, this.jsonObserver);

    const created = await this.getByKey({ tenantId, sessionKey });
    if (!created) throw new Error("failed to create session");
    return created;
  }

  async list(input: {
    scopeKeys?: Partial<ScopeKeys>;
    connectorKey?: string;
    archived?: boolean;
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
      archived: input.archived,
      cursor,
    });

    const rows = await this.db.all<RawSessionListRow>(
      `SELECT s.session_id, s.session_key, ag.agent_key, ca.connector_key, ca.account_key, ct.provider_thread_id, ct.container_kind, s.title, s.messages_json, s.context_state_json, s.archived_at, s.created_at, s.updated_at FROM sessions s JOIN agents ag ON ag.tenant_id = s.tenant_id AND ag.agent_id = s.agent_id JOIN channel_threads ct ON ct.tenant_id = s.tenant_id AND ct.workspace_id = s.workspace_id AND ct.channel_thread_id = s.channel_thread_id JOIN channel_accounts ca ON ca.tenant_id = ct.tenant_id AND ca.workspace_id = ct.workspace_id AND ca.channel_account_id = ct.channel_account_id WHERE ${where.join(" AND ")} ORDER BY s.updated_at DESC, s.session_id DESC LIMIT ?`,
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
    return await resetSessionContent({
      db: this.db,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      updatedAt: new Date().toISOString(),
    });
  }

  async appendTurn(input: {
    tenantId: string;
    sessionId: string;
    userMessage: string;
    assistantMessage: string;
    timestamp: string;
    appendMessages?: boolean;
  }): Promise<SessionRow> {
    const session = await this.requireSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
    });
    const nextMessages: TyrumUIMessage[] =
      input.appendMessages === false
        ? session.messages
        : [
            ...session.messages,
            createTextMessage({ role: "user", text: input.userMessage }),
            createTextMessage({ role: "assistant", text: input.assistantMessage }),
          ];

    await this.writeSession({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      messages: nextMessages,
      title: session.title,
      contextState: createSessionContextStateForMessages(
        nextMessages,
        input.timestamp,
        session.context_state,
      ),
      updatedAt: input.timestamp,
    });

    const updated = await this.getById({ tenantId: input.tenantId, sessionId: input.sessionId });
    if (!updated) throw new Error(`session '${input.sessionId}' missing after update`);
    return updated;
  }

  async setTitleIfBlank(input: SessionIdentity & { title: string }): Promise<boolean> {
    const title = normalizeSessionTitle(input.title);
    if (!title) return false;
    return await setSessionTitleIfBlank({
      db: this.db,
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      title,
      updatedAt: new Date().toISOString(),
    });
  }

  async setArchived(input: SessionIdentity & { archived: boolean }): Promise<boolean> {
    const archivedAt = input.archived ? new Date().toISOString() : null;
    const result = await this.db.run(
      "UPDATE sessions SET archived_at = ? WHERE tenant_id = ? AND session_id = ?",
      [archivedAt, input.tenantId, input.sessionId],
    );
    return (result.changes ?? 0) > 0;
  }

  async deleteExpired(ttlDays: number, agentKey?: string): Promise<number> {
    const days = Math.floor(ttlDays);
    if (!Number.isFinite(days) || days <= 0) return 0;

    const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
    const tenantId = await this.identityScopeDal.ensureTenantId(DEFAULT_TENANT_KEY);
    const normalizedAgentKey = agentKey?.trim();
    const agentId = normalizedAgentKey
      ? ((await this.identityScopeDal.resolveAgentId(tenantId, normalizedAgentKey)) ?? undefined)
      : undefined;
    if (normalizedAgentKey && !agentId) return 0;
    return await deleteExpiredSessions({
      agentId,
      cutoffIso,
      db: this.db,
      tenantId,
    });
  }
}
