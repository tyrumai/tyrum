import {
  NormalizedThreadMessage as NormalizedThreadMessageSchema,
  normalizedContainerKindFromThreadKind,
  parseTyrumKey,
} from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import { WorkboardDal } from "../workboard/dal.js";
import { resolveWorkspaceKey } from "../workspace/id.js";
import { SessionDal } from "../agent/session-dal.js";
import { IdentityScopeDal } from "../identity/scope.js";
import { buildChannelSourceKey, parseChannelSourceKey } from "./interface.js";
import { ChannelThreadDal } from "./thread-dal.js";
import type {
  ChannelInboundQueueOverflowPolicy,
  ChannelInboundQueueOverflowResult,
  ChannelInboxConfig,
  ChannelInboxRow,
  RawChannelInboxRow,
} from "./inbox-dal-types.js";
export type {
  ChannelInboxStatus,
  ChannelInboundQueueOverflowPolicy,
  ChannelInboxConfig,
  ChannelInboundQueueOverflowResult,
  ChannelInboxRow,
} from "./inbox-dal-types.js";
import { normalizeQueueMode, toRow } from "./inbox-dal-helpers.js";
import { executeEnqueueTransaction } from "./inbox-dal-enqueue.js";

const DEFAULT_INBOUND_DEDUPE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_INBOUND_QUEUE_CAP = 100;
const DEFAULT_INBOUND_QUEUE_OVERFLOW = "drop_oldest";

export class ChannelInboxDal {
  private readonly sessionDal: SessionDal;
  private readonly inboundDedupeTtlMs: number;
  private readonly inboundQueueCap: number;
  private readonly inboundQueueOverflowPolicy: ChannelInboundQueueOverflowPolicy;

  constructor(
    private readonly db: SqlDb,
    sessionDal?: SessionDal,
    config?: ChannelInboxConfig,
  ) {
    this.sessionDal =
      sessionDal ?? new SessionDal(db, new IdentityScopeDal(db), new ChannelThreadDal(db));
    const dedupeTtlMsRaw = config?.inboundDedupeTtlMs;
    this.inboundDedupeTtlMs =
      typeof dedupeTtlMsRaw === "number" && Number.isFinite(dedupeTtlMsRaw)
        ? Math.max(1, Math.floor(dedupeTtlMsRaw))
        : DEFAULT_INBOUND_DEDUPE_TTL_MS;

    const capRaw = config?.inboundQueueCap;
    this.inboundQueueCap =
      typeof capRaw === "number" && Number.isFinite(capRaw)
        ? Math.max(1, Math.floor(capRaw))
        : DEFAULT_INBOUND_QUEUE_CAP;

    const policyRaw = config?.inboundQueueOverflowPolicy;
    this.inboundQueueOverflowPolicy =
      policyRaw === "drop_oldest" ||
      policyRaw === "drop_newest" ||
      policyRaw === "summarize_dropped"
        ? policyRaw
        : DEFAULT_INBOUND_QUEUE_OVERFLOW;
  }

  async enqueue(input: {
    source: string;
    thread_id: string;
    message_id: string;
    key: string;
    lane: string;
    queue_mode?: string;
    received_at_ms: number;
    payload: unknown;
  }): Promise<{
    row: ChannelInboxRow;
    deduped: boolean;
    overflow?: ChannelInboundQueueOverflowResult;
  }> {
    const payloadJson = JSON.stringify(input.payload ?? {});
    const receivedAtMs = input.received_at_ms;
    const ttlMs = this.inboundDedupeTtlMs;
    const expiresAtMs = receivedAtMs + Math.max(1, ttlMs);

    const sourceRaw = input.source.trim();
    if (!sourceRaw.includes(":")) {
      throw new Error('channel source must be in "connector:account" form');
    }
    const address = parseChannelSourceKey(sourceRaw);
    const channel = address.connector;
    const accountId = address.accountId;
    const source = buildChannelSourceKey({ connector: channel, accountId });
    const containerId = input.thread_id.trim();
    const messageId = input.message_id.trim();
    const queueMode = normalizeQueueMode(input.queue_mode);
    const cap = this.inboundQueueCap;
    const overflowPolicy = this.inboundQueueOverflowPolicy;

    const payloadParsed = NormalizedThreadMessageSchema.safeParse(input.payload);
    const containerKind = payloadParsed.success
      ? normalizedContainerKindFromThreadKind(payloadParsed.data.thread.kind)
      : "channel";

    let agentKey = "default";
    try {
      const parsedKey = parseTyrumKey(input.key as never);
      if (parsedKey.kind === "agent") {
        agentKey = parsedKey.agent_key;
      }
    } catch {
      // Intentional: fall back to default agent when key parsing fails.
    }

    const session = await this.sessionDal.getOrCreate({
      scopeKeys: { agentKey, workspaceKey: resolveWorkspaceKey() },
      connectorKey: channel,
      accountKey: accountId,
      providerThreadId: containerId,
      containerKind,
    });

    const tenantId = session.tenant_id;
    const workspaceId = session.workspace_id;
    const sessionId = session.session_id;
    const channelThreadId = session.channel_thread_id;

    const result = await this.db.transaction(async (tx) =>
      executeEnqueueTransaction(tx, {
        tenantId,
        workspaceId,
        sessionId,
        channelThreadId,
        channel,
        accountId,
        source,
        containerId,
        messageId,
        key: input.key,
        lane: input.lane,
        queueMode,
        receivedAtMs,
        payloadJson,
        payload: input.payload,
        ttlMs,
        expiresAtMs,
        cap,
        overflowPolicy,
      }),
    );

    // Best-effort update of durable last-active routing for completion notifications.
    try {
      await new WorkboardDal(this.db).upsertScopeActivity({
        scope: {
          tenant_id: tenantId,
          agent_id: session.agent_id,
          workspace_id: workspaceId,
        },
        last_active_session_key: input.key,
        updated_at_ms: receivedAtMs,
      });
    } catch (err) {
      // Intentional: completion notifications are best-effort; ignore activity update failures.
      void err;
    }

    return result;
  }

  async getById(inboxId: number): Promise<ChannelInboxRow | undefined> {
    const row = await this.db.get<RawChannelInboxRow>(
      "SELECT * FROM channel_inbox WHERE inbox_id = ?",
      [inboxId],
    );
    return row ? toRow(row) : undefined;
  }

  async getByDedupeKey(input: {
    tenant_id: string;
    source: string;
    thread_id: string;
    message_id: string;
  }): Promise<ChannelInboxRow | undefined> {
    const row = await this.db.get<RawChannelInboxRow>(
      `SELECT *
       FROM channel_inbox
       WHERE tenant_id = ?
         AND source = ?
         AND thread_id = ?
         AND message_id = ?
       ORDER BY received_at_ms DESC, inbox_id DESC
       LIMIT 1`,
      [input.tenant_id, input.source, input.thread_id, input.message_id],
    );
    return row ? toRow(row) : undefined;
  }

  async claimNext(input: {
    owner: string;
    now_ms: number;
    lease_ttl_ms: number;
  }): Promise<ChannelInboxRow | undefined> {
    const leaseExpiresAt = input.now_ms + Math.max(1, input.lease_ttl_ms);

    return await this.db.transaction(async (tx) => {
      const candidate = await tx.get<RawChannelInboxRow>(
        `SELECT *
         FROM channel_inbox
         WHERE status = 'queued'
            OR (status = 'processing' AND lease_expires_at_ms IS NOT NULL AND lease_expires_at_ms <= ?)
         ORDER BY received_at_ms ASC, inbox_id ASC
         LIMIT 1`,
        [input.now_ms],
      );
      if (!candidate) return undefined;

      const updated = await tx.run(
        `UPDATE channel_inbox
         SET status = 'processing',
             lease_owner = ?,
             lease_expires_at_ms = ?,
             attempt = attempt + 1
         WHERE inbox_id = ?
           AND (
             status = 'queued'
             OR (status = 'processing' AND lease_expires_at_ms IS NOT NULL AND lease_expires_at_ms <= ?)
           )`,
        [input.owner, leaseExpiresAt, candidate.inbox_id, input.now_ms],
      );
      if (updated.changes !== 1) return undefined;

      const claimed = await tx.get<RawChannelInboxRow>(
        "SELECT * FROM channel_inbox WHERE inbox_id = ?",
        [candidate.inbox_id],
      );
      return claimed ? toRow(claimed) : undefined;
    });
  }

  async requeue(inboxId: number, owner: string): Promise<boolean> {
    const result = await this.db.run(
      `UPDATE channel_inbox
       SET status = 'queued',
           lease_owner = NULL,
           lease_expires_at_ms = NULL
       WHERE inbox_id = ? AND lease_owner = ? AND status = 'processing'`,
      [inboxId, owner],
    );
    return result.changes === 1;
  }

  async markCompleted(inboxId: number, owner: string, replyText: string): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const result = await this.db.run(
      `UPDATE channel_inbox
       SET status = 'completed',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           processed_at = ?,
           error = NULL,
           reply_text = ?
       WHERE inbox_id = ? AND lease_owner = ? AND status = 'processing'`,
      [nowIso, replyText, inboxId, owner],
    );
    if (result.changes !== 1) return false;

    // Queue-only semantics: delete completed rows that have no pending outbox work.
    await this.db.run(
      `DELETE FROM channel_inbox
       WHERE inbox_id = ?
         AND status = 'completed'
         AND NOT EXISTS (SELECT 1 FROM channel_outbox WHERE inbox_id = ?)`,
      [inboxId, inboxId],
    );

    return true;
  }

  async markFailed(inboxId: number, owner: string, error: string): Promise<boolean> {
    const nowIso = new Date().toISOString();
    const result = await this.db.run(
      `UPDATE channel_inbox
       SET status = 'failed',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           processed_at = ?,
           error = ?
       WHERE inbox_id = ? AND lease_owner = ? AND status = 'processing'`,
      [nowIso, error, inboxId, owner],
    );
    return result.changes === 1;
  }

  async listQueuedForKey(input: {
    tenant_id: string;
    key: string;
    lane: string;
    received_at_ms_gte: number;
    received_at_ms_lte: number;
    limit: number;
    queue_mode?: string;
  }): Promise<ChannelInboxRow[]> {
    if (input.limit <= 0) return [];
    const queueMode = input.queue_mode?.trim();
    const queueModeClause = queueMode ? " AND queue_mode = ?" : "";
    const queueModeArgs = queueMode ? [queueMode] : [];
    const rows = await this.db.all<RawChannelInboxRow>(
      `SELECT *
       FROM channel_inbox
       WHERE tenant_id = ?
         AND status = 'queued'
         AND key = ?
         AND lane = ?
         AND received_at_ms >= ?
         AND received_at_ms <= ?
         ${queueModeClause}
       ORDER BY received_at_ms ASC, inbox_id ASC
       LIMIT ?`,
      [
        input.tenant_id,
        input.key,
        input.lane,
        input.received_at_ms_gte,
        input.received_at_ms_lte,
        ...queueModeArgs,
        Math.max(1, input.limit),
      ],
    );
    return rows.map(toRow);
  }

  async claimBatchByIds(input: {
    inbox_ids: number[];
    owner: string;
    now_ms: number;
    lease_ttl_ms: number;
  }): Promise<number> {
    if (input.inbox_ids.length === 0) return 0;
    const leaseExpiresAt = input.now_ms + Math.max(1, input.lease_ttl_ms);

    return await this.db.transaction(async (tx) => {
      let claimed = 0;
      for (const id of input.inbox_ids) {
        const updated = await tx.run(
          `UPDATE channel_inbox
           SET status = 'processing',
               lease_owner = ?,
               lease_expires_at_ms = ?,
               attempt = attempt + 1
           WHERE inbox_id = ? AND status = 'queued'`,
          [input.owner, leaseExpiresAt, id],
        );
        claimed += updated.changes;
      }
      return claimed;
    });
  }
}
