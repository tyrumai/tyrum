import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import {
  IntervalScheduler,
  pruneInBatches,
  resolvePositiveInt,
  tryAcquirePostgresXactLock,
} from "../lifecycle/scheduler.js";

const DEFAULT_TICK_MS = 5 * 60_000;
const DEFAULT_BATCH_SIZE = 10_000;
const DEFAULT_MAX_BATCHES_PER_TICK = 10;
const DEFAULT_SESSIONS_TTL_DAYS = 30;
const DEFAULT_CHANNEL_TERMINAL_RETENTION_DAYS = 7;

const PG_RETENTION_LOCK_KEY1 = 1959359839; // "tyru" as int-ish
const PG_RETENTION_LOCK_KEY2 = 1936024435; // "stlr" as int-ish

export interface StateStoreLifecycleSchedulerClock {
  nowMs: number;
  nowIso: string;
}

export type StateStoreLifecycleSchedulerClockFn = () => StateStoreLifecycleSchedulerClock;

export interface StateStoreLifecycleSchedulerOptions {
  db: SqlDb;
  logger?: Logger;
  metrics?: MetricsRegistry;
  tickMs?: number;
  batchSize?: number;
  maxBatchesPerTick?: number;
  sessionsTtlDays?: number;
  channelTerminalRetentionDays?: number;
  keepProcessAlive?: boolean;
  clock?: StateStoreLifecycleSchedulerClockFn;
}

function defaultClock(): StateStoreLifecycleSchedulerClock {
  const now = new Date();
  return { nowMs: now.getTime(), nowIso: now.toISOString() };
}

export class StateStoreLifecycleScheduler {
  private readonly db: SqlDb;
  private readonly logger?: Logger;
  private readonly metrics?: MetricsRegistry;
  private readonly batchSize: number;
  private readonly maxBatchesPerTick: number;
  private readonly sessionsTtlDays: number;
  private readonly channelTerminalRetentionDays: number;
  private readonly clock: StateStoreLifecycleSchedulerClockFn;
  private readonly interval: IntervalScheduler;

  constructor(opts: StateStoreLifecycleSchedulerOptions) {
    this.db = opts.db;
    this.logger = opts.logger;
    this.metrics = opts.metrics;
    const tickMs = resolvePositiveInt(opts.tickMs, DEFAULT_TICK_MS);
    this.batchSize = Math.max(
      1,
      Math.min(1_000_000, resolvePositiveInt(opts.batchSize, DEFAULT_BATCH_SIZE)),
    );
    this.maxBatchesPerTick = Math.max(
      1,
      Math.min(1000, Math.floor(opts.maxBatchesPerTick ?? DEFAULT_MAX_BATCHES_PER_TICK)),
    );
    const sessionsTtl = opts.sessionsTtlDays;
    this.sessionsTtlDays =
      typeof sessionsTtl === "number" && Number.isFinite(sessionsTtl) && sessionsTtl > 0
        ? Math.max(1, Math.floor(sessionsTtl))
        : DEFAULT_SESSIONS_TTL_DAYS;
    const channelTerminalRetentionDays = opts.channelTerminalRetentionDays;
    this.channelTerminalRetentionDays =
      typeof channelTerminalRetentionDays === "number" &&
      Number.isFinite(channelTerminalRetentionDays) &&
      channelTerminalRetentionDays > 0
        ? Math.max(1, Math.floor(channelTerminalRetentionDays))
        : DEFAULT_CHANNEL_TERMINAL_RETENTION_DAYS;
    this.clock = opts.clock ?? defaultClock;
    const keepProcessAlive = opts.keepProcessAlive ?? false;
    this.interval = new IntervalScheduler({
      tickMs,
      keepProcessAlive,
      onTickError: (err) => {
        this.metrics?.recordLifecycleTickError("statestore");
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error("statestore.lifecycle_tick_failed", { error: message });
      },
      tick: () => this.tickOnce(),
    });
  }

  start(): void {
    this.interval.start();
  }

  stop(): void {
    this.interval.stop();
  }

  /** Exposed for testing — runs one retention/TTL-prune cycle. */
  async tick(): Promise<void> {
    await this.interval.tick();
  }

  private async tickOnce(): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (tx.kind === "postgres") {
        const acquired = await tryAcquirePostgresXactLock(
          tx,
          PG_RETENTION_LOCK_KEY1,
          PG_RETENTION_LOCK_KEY2,
        );
        if (!acquired) return;
      }
      await this.runOnce(tx);
    });
  }

  private async runOnce(db: SqlDb): Promise<void> {
    const { nowMs, nowIso } = this.clock();
    const sessionsCutoffIso = new Date(
      nowMs - this.sessionsTtlDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const channelTerminalCutoffIso = new Date(
      nowMs - this.channelTerminalRetentionDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const channelTerminalCutoffMs = nowMs - this.channelTerminalRetentionDays * 24 * 60 * 60 * 1000;

    const sessionsPruned = await this.pruneInBatches("sessions", () =>
      this.pruneExpiredSessions(db, { cutoffIso: sessionsCutoffIso }),
    );
    this.metrics?.recordLifecyclePruneRows("statestore", "sessions", sessionsPruned);
    const connectionsPruned = await this.pruneInBatches("connections", () =>
      this.pruneExpiredConnections(db, { nowMs }),
    );
    this.metrics?.recordLifecyclePruneRows("statestore", "connections", connectionsPruned);
    const presencePruned = await this.pruneInBatches("presence_entries", () =>
      this.pruneExpiredPresenceEntries(db, { nowMs }),
    );
    this.metrics?.recordLifecyclePruneRows("statestore", "presence_entries", presencePruned);
    const dedupePruned = await this.pruneInBatches("channel_inbound_dedupe", () =>
      this.pruneExpiredInboundDedupe(db, { nowMs }),
    );
    this.metrics?.recordLifecyclePruneRows("statestore", "channel_inbound_dedupe", dedupePruned);
    const inboxFailedPruned = await this.pruneInBatches("channel_inbox.failed", () =>
      this.pruneFailedChannelInbox(db, { cutoffMs: channelTerminalCutoffMs }),
    );
    this.metrics?.recordLifecyclePruneRows("statestore", "channel_inbox.failed", inboxFailedPruned);
    const inboxCompletedPruned = await this.pruneInBatches("channel_inbox.completed", () =>
      this.pruneCompletedChannelInbox(db, { cutoffMs: channelTerminalCutoffMs }),
    );
    this.metrics?.recordLifecyclePruneRows(
      "statestore",
      "channel_inbox.completed",
      inboxCompletedPruned,
    );
    const outboxFailedPruned = await this.pruneInBatches("channel_outbox.failed", () =>
      this.pruneFailedChannelOutbox(db, { cutoffIso: channelTerminalCutoffIso }),
    );
    this.metrics?.recordLifecyclePruneRows(
      "statestore",
      "channel_outbox.failed",
      outboxFailedPruned,
    );
    const laneLeasesPruned = await this.pruneInBatches("lane_leases", () =>
      this.pruneExpiredLaneLeases(db, { nowMs }),
    );
    this.metrics?.recordLifecyclePruneRows("statestore", "lane_leases", laneLeasesPruned);
    const workspaceLeasesPruned = await this.pruneInBatches("workspace_leases", () =>
      this.pruneExpiredWorkspaceLeases(db, { nowMs }),
    );
    this.metrics?.recordLifecyclePruneRows("statestore", "workspace_leases", workspaceLeasesPruned);
    const oauthPendingPruned = await this.pruneInBatches("oauth_pending", () =>
      this.pruneExpiredOauthPending(db, { nowIso }),
    );
    this.metrics?.recordLifecyclePruneRows("statestore", "oauth_pending", oauthPendingPruned);
    const oauthRefreshLeasesPruned = await this.pruneInBatches("oauth_refresh_leases", () =>
      this.pruneExpiredOauthRefreshLeases(db, { nowMs }),
    );
    this.metrics?.recordLifecyclePruneRows(
      "statestore",
      "oauth_refresh_leases",
      oauthRefreshLeasesPruned,
    );
    const modelsDevRefreshLeasesPruned = await this.pruneInBatches(
      "models_dev_refresh_leases",
      () => this.pruneExpiredModelsDevRefreshLeases(db, { nowMs }),
    );
    this.metrics?.recordLifecyclePruneRows(
      "statestore",
      "models_dev_refresh_leases",
      modelsDevRefreshLeasesPruned,
    );

    if (
      sessionsPruned +
        connectionsPruned +
        presencePruned +
        dedupePruned +
        inboxFailedPruned +
        inboxCompletedPruned +
        outboxFailedPruned +
        laneLeasesPruned +
        workspaceLeasesPruned +
        oauthPendingPruned +
        oauthRefreshLeasesPruned +
        modelsDevRefreshLeasesPruned >
      0
    ) {
      this.logger?.info("statestore.lifecycle_pruned", {
        now: nowIso,
        sessions: sessionsPruned,
        connections: connectionsPruned,
        presence_entries: presencePruned,
        channel_inbound_dedupe: dedupePruned,
        channel_inbox_failed: inboxFailedPruned,
        channel_inbox_completed: inboxCompletedPruned,
        channel_outbox_failed: outboxFailedPruned,
        lane_leases: laneLeasesPruned,
        workspace_leases: workspaceLeasesPruned,
        oauth_pending: oauthPendingPruned,
        oauth_refresh_leases: oauthRefreshLeasesPruned,
        models_dev_refresh_leases: modelsDevRefreshLeasesPruned,
      });
    }
  }

  private async pruneInBatches(name: string, pruneOnce: () => Promise<number>): Promise<number> {
    return await pruneInBatches(
      {
        batchSize: this.batchSize,
        maxBatchesPerTick: this.maxBatchesPerTick,
        onBudgetExhausted: () => {
          this.logger?.warn("statestore.lifecycle_prune_budget_exhausted", {
            task: name,
            batch_size: this.batchSize,
            max_batches: this.maxBatchesPerTick,
          });
        },
      },
      pruneOnce,
    );
  }

  private async pruneExpiredSessions(db: SqlDb, input: { cutoffIso: string }): Promise<number> {
    const sessionCutoff = {
      clause: "updated_at < ?",
      order: "updated_at ASC, tenant_id ASC, session_id ASC",
      params: [input.cutoffIso],
    };

    const batch = [...sessionCutoff.params, this.batchSize];

    await db.run(
      `DELETE FROM session_model_overrides
       WHERE (tenant_id, session_id) IN (
         SELECT tenant_id, session_id
         FROM sessions
         WHERE ${sessionCutoff.clause}
         ORDER BY ${sessionCutoff.order}
         LIMIT ?
       )`,
      batch,
    );

    await db.run(
      `DELETE FROM session_provider_pins
       WHERE (tenant_id, session_id) IN (
         SELECT tenant_id, session_id
         FROM sessions
         WHERE ${sessionCutoff.clause}
         ORDER BY ${sessionCutoff.order}
         LIMIT ?
       )`,
      batch,
    );

    await db.run(
      `DELETE FROM context_reports
       WHERE (tenant_id, session_id) IN (
         SELECT tenant_id, session_id
         FROM sessions
         WHERE ${sessionCutoff.clause}
         ORDER BY ${sessionCutoff.order}
         LIMIT ?
       )`,
      batch,
    );

    return (
      await db.run(
        `DELETE FROM sessions
       WHERE (tenant_id, session_id) IN (
         SELECT tenant_id, session_id
         FROM sessions
         WHERE ${sessionCutoff.clause}
         ORDER BY ${sessionCutoff.order}
         LIMIT ?
       )`,
        batch,
      )
    ).changes;
  }

  private async pruneExpiredConnections(db: SqlDb, input: { nowMs: number }): Promise<number> {
    return (
      await db.run(
        `DELETE FROM connections
         WHERE (tenant_id, connection_id) IN (
           SELECT tenant_id, connection_id
           FROM connections
           WHERE expires_at_ms <= ?
           ORDER BY expires_at_ms ASC, tenant_id ASC, connection_id ASC
           LIMIT ?
         )`,
        [input.nowMs, this.batchSize],
      )
    ).changes;
  }

  private async pruneExpiredPresenceEntries(db: SqlDb, input: { nowMs: number }): Promise<number> {
    return (
      await db.run(
        `DELETE FROM presence_entries
         WHERE instance_id IN (
           SELECT instance_id
           FROM presence_entries
           WHERE expires_at_ms <= ?
           ORDER BY expires_at_ms ASC, instance_id ASC
           LIMIT ?
         )`,
        [input.nowMs, this.batchSize],
      )
    ).changes;
  }

  private async pruneExpiredInboundDedupe(db: SqlDb, input: { nowMs: number }): Promise<number> {
    return (
      await db.run(
        `DELETE FROM channel_inbound_dedupe
       WHERE (tenant_id, channel, account_id, container_id, message_id) IN (
         SELECT tenant_id, channel, account_id, container_id, message_id
         FROM channel_inbound_dedupe
         WHERE expires_at_ms <= ?
         ORDER BY expires_at_ms ASC
         LIMIT ?
       )`,
        [input.nowMs, this.batchSize],
      )
    ).changes;
  }

  private async pruneExpiredLaneLeases(db: SqlDb, input: { nowMs: number }): Promise<number> {
    return (
      await db.run(
        `DELETE FROM lane_leases
         WHERE (tenant_id, key, lane) IN (
           SELECT tenant_id, key, lane
           FROM lane_leases
           WHERE lease_expires_at_ms <= ?
           ORDER BY lease_expires_at_ms ASC, tenant_id ASC, key ASC, lane ASC
           LIMIT ?
         )`,
        [input.nowMs, this.batchSize],
      )
    ).changes;
  }

  private async pruneExpiredWorkspaceLeases(db: SqlDb, input: { nowMs: number }): Promise<number> {
    return (
      await db.run(
        `DELETE FROM workspace_leases
         WHERE (tenant_id, workspace_id) IN (
           SELECT tenant_id, workspace_id
           FROM workspace_leases
           WHERE lease_expires_at_ms <= ?
           ORDER BY lease_expires_at_ms ASC, tenant_id ASC, workspace_id ASC
           LIMIT ?
         )`,
        [input.nowMs, this.batchSize],
      )
    ).changes;
  }

  private async pruneExpiredOauthPending(db: SqlDb, input: { nowIso: string }): Promise<number> {
    return (
      await db.run(
        `DELETE FROM oauth_pending
         WHERE (tenant_id, state) IN (
           SELECT tenant_id, state
           FROM oauth_pending
           WHERE expires_at <= ?
           ORDER BY expires_at ASC, tenant_id ASC, state ASC
           LIMIT ?
         )`,
        [input.nowIso, this.batchSize],
      )
    ).changes;
  }

  private async pruneExpiredOauthRefreshLeases(
    db: SqlDb,
    input: { nowMs: number },
  ): Promise<number> {
    return (
      await db.run(
        `DELETE FROM oauth_refresh_leases
         WHERE (tenant_id, auth_profile_id) IN (
           SELECT tenant_id, auth_profile_id
           FROM oauth_refresh_leases
           WHERE lease_expires_at_ms <= ?
           ORDER BY lease_expires_at_ms ASC, tenant_id ASC, auth_profile_id ASC
           LIMIT ?
         )`,
        [input.nowMs, this.batchSize],
      )
    ).changes;
  }

  private async pruneExpiredModelsDevRefreshLeases(
    db: SqlDb,
    input: { nowMs: number },
  ): Promise<number> {
    return (
      await db.run(
        `DELETE FROM models_dev_refresh_leases
         WHERE key IN (
           SELECT key
           FROM models_dev_refresh_leases
           WHERE lease_expires_at_ms <= ?
           ORDER BY lease_expires_at_ms ASC, key ASC
           LIMIT ?
         )`,
        [input.nowMs, this.batchSize],
      )
    ).changes;
  }

  private async pruneFailedChannelInbox(db: SqlDb, input: { cutoffMs: number }): Promise<number> {
    return (
      await db.run(
        `DELETE FROM channel_inbox
         WHERE inbox_id IN (
           SELECT inbox_id
           FROM channel_inbox
           WHERE status = 'failed'
             AND received_at_ms <= ?
           ORDER BY received_at_ms ASC, inbox_id ASC
           LIMIT ?
         )`,
        [input.cutoffMs, this.batchSize],
      )
    ).changes;
  }

  private async pruneCompletedChannelInbox(
    db: SqlDb,
    input: { cutoffMs: number },
  ): Promise<number> {
    return (
      await db.run(
        `DELETE FROM channel_inbox
         WHERE inbox_id IN (
           SELECT inbox_id
           FROM channel_inbox i
           WHERE i.status = 'completed'
             AND i.received_at_ms <= ?
             AND NOT EXISTS (SELECT 1 FROM channel_outbox o WHERE o.inbox_id = i.inbox_id)
           ORDER BY i.received_at_ms ASC, i.inbox_id ASC
           LIMIT ?
         )`,
        [input.cutoffMs, this.batchSize],
      )
    ).changes;
  }

  private async pruneFailedChannelOutbox(db: SqlDb, input: { cutoffIso: string }): Promise<number> {
    return (
      await db.run(
        `DELETE FROM channel_outbox
         WHERE outbox_id IN (
           SELECT outbox_id
           FROM channel_outbox
           WHERE status = 'failed'
             AND sent_at IS NOT NULL
             AND sent_at <= ?
           ORDER BY sent_at ASC, outbox_id ASC
           LIMIT ?
         )`,
        [input.cutoffIso, this.batchSize],
      )
    ).changes;
  }
}
