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
  RawConversationListRow,
  RawConversationRow,
  RawConversationWithDeliveryRow,
  ConversationDalOptions,
  ConversationIdentity,
  ConversationListRow,
  ConversationRow,
  ConversationWithDelivery,
} from "./conversation-dal-helpers.js";
import {
  buildConversationSelectSql,
  buildConversationWithDeliverySql,
  createEmptyConversationContextState,
  normalizeContainerKind,
  normalizeConversationTitle,
  normalizeTime,
  toConversationListRow,
  toConversationRow,
} from "./conversation-dal-helpers.js";
import { writeContextStateTx, writeConversationMessagesTx } from "./conversation-dal-write-helpers.js";
import { upsertConversationStateTx } from "./conversation-dal-storage.js";
import {
  buildConversationListWhereClause,
  createConversationContextStateForMessages,
  decodeConversationCursor,
  encodeConversationCursor,
} from "./conversation-dal-runtime.js";
import { buildDeterministicFallbackCheckpoint } from "./runtime/conversation-compaction-fallback.js";
import {
  collectPendingApprovals,
  collectPendingToolStates,
  extractCriticalIdentifiers,
  extractRelevantFiles,
  splitMessagesForContextCompaction,
} from "./runtime/conversation-context-state.js";
import {
  createTextMessage,
  deleteExpiredConversations,
  resetConversationContent,
  setConversationTitleIfBlank,
} from "./conversation-dal-message-helpers.js";
import { replaceConversationArtifactLinksTx } from "../artifact/dal.js";
import { insertArtifactRecordTx } from "../artifact/dal.js";
import type { ArtifactRecordInsertInput } from "../artifact/dal.js";

export type {
  ConversationState,
  ConversationRow,
  ConversationListRow,
  ConversationWithDelivery,
  ConversationDalOptions,
} from "./conversation-dal-helpers.js";

const logger = new Logger({ base: { module: "agent.conversation_dal" } });

export class ConversationDal {
  private readonly jsonObserver: PersistedJsonObserver;

  constructor(
    private readonly db: SqlDb,
    private readonly identityScopeDal: IdentityScopeDal,
    private readonly channelThreadDal: ChannelThreadDal,
    opts?: ConversationDalOptions,
  ) {
    this.jsonObserver = {
      logger: opts?.logger ?? logger,
      metrics: opts?.metrics ?? gatewayMetrics,
    };
  }

  private async getRawConversation(
    column: "conversation_id" | "conversation_key",
    tenantId: string,
    value: string,
  ): Promise<RawConversationRow | undefined> {
    return this.db.get<RawConversationRow>(
      `SELECT ${buildConversationSelectSql(this.db.kind)}
       FROM conversations s
       WHERE s.tenant_id = ? AND s.${column} = ?
       LIMIT 1`,
      [tenantId, value],
    );
  }

  private async requireConversation(input: ConversationIdentity): Promise<ConversationRow> {
    const conversation = await this.getById(input);
    if (!conversation) throw new Error(`conversation '${input.conversationId}' not found`);
    return conversation;
  }

  async replaceMessages(
    input: ConversationIdentity & {
      messages: TyrumUIMessage[];
      updatedAt?: string;
      artifactRecords?: readonly ArtifactRecordInsertInput[];
    },
  ): Promise<void> {
    const conversation = await this.requireConversation({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    });
    await this.db.transaction(async (tx) => {
      const updatedAt = input.updatedAt ?? new Date().toISOString();
      const contextState = createConversationContextStateForMessages(
        input.messages,
        updatedAt,
        conversation.context_state,
      );
      await writeConversationMessagesTx({
        db: tx,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        messages: input.messages,
        title: conversation.title,
        contextState,
        updatedAt,
      });
      for (const artifactRecord of input.artifactRecords ?? []) {
        await insertArtifactRecordTx(tx, artifactRecord);
      }
      await replaceConversationArtifactLinksTx(tx, {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        previousMessages: conversation.messages,
        nextMessages: input.messages,
      });
    });
  }

  async replaceContextState(
    input: ConversationIdentity & {
      contextState: ConversationState;
      updatedAt?: string;
    },
  ): Promise<void> {
    const conversation = await this.requireConversation({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    });
    await this.db.transaction(async (tx) => {
      await writeContextStateTx({
        db: tx,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        title: conversation.title,
        contextState: input.contextState,
        updatedAt: input.updatedAt,
      });
    });
  }

  async compact(
    input: ConversationIdentity & { keepLastMessages: number; updatedAt?: string },
  ): Promise<{ droppedMessages: number; keptMessages: number; summary: string }> {
    const conversation = await this.requireConversation({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    });
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    const { dropped, kept } = splitMessagesForContextCompaction({
      messages: conversation.messages,
      keepLastMessages: input.keepLastMessages,
    });
    if (dropped.length === 0) {
      return {
        droppedMessages: 0,
        keptMessages: kept.length,
        summary: conversation.context_state.checkpoint?.handoff_md ?? "",
      };
    }
    const criticalIdentifiers = extractCriticalIdentifiers(dropped);
    const checkpoint = buildDeterministicFallbackCheckpoint({
      previousCheckpoint: conversation.context_state.checkpoint,
      droppedMessages: dropped,
      criticalIdentifiers,
      relevantFiles: extractRelevantFiles(criticalIdentifiers),
    });
    const contextState = {
      ...conversation.context_state,
      compacted_through_message_id: dropped.at(-1)?.id,
      recent_message_ids: kept.map((message) => message.id),
      checkpoint,
      pending_approvals: collectPendingApprovals(conversation.messages),
      pending_tool_state: collectPendingToolStates(conversation.messages),
      updated_at: updatedAt,
    };
    await this.replaceContextState({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      contextState,
      updatedAt,
    });
    return {
      droppedMessages: dropped.length,
      keptMessages: kept.length,
      summary: checkpoint.handoff_md,
    };
  }

  async getById(input: { tenantId: string; conversationId: string }): Promise<ConversationRow | undefined> {
    const row = await this.getRawConversation("conversation_id", input.tenantId, input.conversationId);
    return row ? toConversationRow(row, this.jsonObserver) : undefined;
  }

  async getByKey(input: { tenantId: string; conversationKey: string }): Promise<ConversationRow | undefined> {
    const row = await this.getRawConversation("conversation_key", input.tenantId, input.conversationKey);
    return row ? toConversationRow(row, this.jsonObserver) : undefined;
  }

  async getWithDeliveryByKey(input: {
    tenantId: string;
    conversationKey: string;
  }): Promise<ConversationWithDelivery | undefined> {
    const row = await this.db.get<RawConversationWithDeliveryRow>(
      buildConversationWithDeliverySql(this.db.kind),
      [input.tenantId, input.conversationKey],
    );
    return row
      ? {
          conversation: toConversationRow(row, this.jsonObserver),
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
  }): Promise<ConversationRow> {
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
    const conversationKey = buildAgentTurnKey({
      agentId: keys.agentKey,
      workspaceId: keys.workspaceKey,
      channel: connectorKey,
      containerKind: input.containerKind,
      threadId: input.providerThreadId,
      deliveryAccount: accountKey === DEFAULT_CHANNEL_ACCOUNT_ID ? undefined : accountKey,
    });

    const existing = await this.getByKey({ tenantId, conversationKey });
    if (existing) return existing;

    const nowIso = new Date().toISOString();
    const conversationId = randomUUID();
    const inserted = await this.db.transaction(async (tx) => {
      const result = await tx.run(
        `INSERT INTO conversations (
           tenant_id,
           conversation_id,
           conversation_key,
           agent_id,
           workspace_id,
           channel_thread_id,
           title,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)
         ON CONFLICT (tenant_id, conversation_key) DO NOTHING`,
        [tenantId, conversationId, conversationKey, agentId, workspaceId, channelThreadId, nowIso, nowIso],
      );
      if (result.changes !== 1) {
        return false;
      }
      await upsertConversationStateTx(tx, {
        tenantId,
        conversationId: conversationId,
        contextState: createEmptyConversationContextState(nowIso),
      });
      return true;
    });
    if (inserted) {
      const created = await this.getById({ tenantId, conversationId });
      if (created) return created;
    }

    const created = await this.getByKey({ tenantId, conversationKey });
    if (!created) throw new Error("failed to create conversation");
    return created;
  }

  async list(input: {
    scopeKeys?: Partial<ScopeKeys>;
    connectorKey?: string;
    archived?: boolean;
    limit?: number;
    cursor?: string;
  }): Promise<{ conversations: ConversationListRow[]; nextCursor: string | null }> {
    const keys = normalizeScopeKeys(input.scopeKeys);
    const scopeIds = await this.identityScopeDal.resolveScopeIds(keys);
    const connectorKeyRaw = input.connectorKey?.trim();
    const connectorKey = connectorKeyRaw ? normalizeConnectorId(connectorKeyRaw) : undefined;
    const limit = Math.min(200, Math.max(1, Math.floor(input.limit ?? 50)));
    const cursor = input.cursor ? decodeConversationCursor(input.cursor) : undefined;
    if (input.cursor && !cursor) throw new Error("invalid cursor");
    const { where, params } = buildConversationListWhereClause({
      tenantId: scopeIds.tenantId,
      agentId: scopeIds.agentId,
      workspaceId: scopeIds.workspaceId,
      connectorKey,
      archived: input.archived,
      cursor,
    });

    const rows = await this.db.all<RawConversationListRow>(
      `SELECT ${buildConversationSelectSql(this.db.kind, "s")},
              ag.agent_key,
              ca.connector_key,
              ca.account_key,
              ct.provider_thread_id,
              ct.container_kind
       FROM conversations s
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
       ORDER BY s.updated_at DESC, s.conversation_id DESC
       LIMIT ?`,
      [...params, limit + 1],
    );
    const selectedRows = rows.slice(0, limit);
    const last = selectedRows.at(-1);
    return {
      conversations: selectedRows.map((row) => toConversationListRow(row, this.jsonObserver)),
      nextCursor:
        rows.length > limit && last
          ? encodeConversationCursor({
              updated_at: normalizeTime(last.updated_at),
              conversation_id: last.conversation_id,
            })
          : null,
    };
  }

  async reset(input: ConversationIdentity): Promise<boolean> {
    return await resetConversationContent({
      db: this.db,
      conversationId: input.conversationId,
      tenantId: input.tenantId,
      updatedAt: new Date().toISOString(),
    });
  }

  async appendTurn(input: {
    tenantId: string;
    conversationId: string;
    userMessage: string;
    assistantMessage: string;
    timestamp: string;
    appendMessages?: boolean;
  }): Promise<ConversationRow> {
    const conversation = await this.requireConversation({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    });
    const nextMessages: TyrumUIMessage[] =
      input.appendMessages === false
        ? conversation.messages
        : [
            ...conversation.messages,
            createTextMessage({ role: "user", text: input.userMessage }),
            createTextMessage({ role: "assistant", text: input.assistantMessage }),
          ];

    await this.db.transaction(async (tx) => {
      await writeConversationMessagesTx({
        db: tx,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        messages: nextMessages,
        title: conversation.title,
        contextState: createConversationContextStateForMessages(
          nextMessages,
          input.timestamp,
          conversation.context_state,
        ),
        updatedAt: input.timestamp,
      });
    });

    const updated = await this.getById({ tenantId: input.tenantId, conversationId: input.conversationId });
    if (!updated) throw new Error(`conversation '${input.conversationId}' missing after update`);
    return updated;
  }

  async setTitleIfBlank(input: ConversationIdentity & { title: string }): Promise<boolean> {
    const title = normalizeConversationTitle(input.title);
    if (!title) return false;
    return await setConversationTitleIfBlank({
      db: this.db,
      conversationId: input.conversationId,
      tenantId: input.tenantId,
      title,
      updatedAt: new Date().toISOString(),
    });
  }

  async setArchived(input: ConversationIdentity & { archived: boolean }): Promise<boolean> {
    const archivedAt = input.archived ? new Date().toISOString() : null;
    const result = await this.db.run(
      "UPDATE conversations SET archived_at = ? WHERE tenant_id = ? AND conversation_id = ?",
      [archivedAt, input.tenantId, input.conversationId],
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
    return await deleteExpiredConversations({
      agentId,
      cutoffIso,
      db: this.db,
      tenantId,
    });
  }
}
