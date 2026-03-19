import type { AgentRegistry } from "../agent/registry.js";
import type { Logger } from "../observability/logger.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";
import type { ChannelConfigDal, StoredTelegramChannelConfig } from "./channel-config-dal.js";
import type { TelegramChannelRuntime } from "./telegram-runtime.js";
import type { TelegramChannelQueue } from "./telegram.js";
import { TelegramPollingStateDal } from "./telegram-polling-state-dal.js";
import {
  processTelegramInboundUpdate,
  TelegramInboundTemporaryFailure,
} from "./telegram-inbound.js";
import { TelegramNormalizationError } from "../ingress/telegram.js";
import type { RoutingConfigDal } from "./routing-config-dal.js";
import type { MemoryDal } from "../memory/memory-dal.js";

const DEFAULT_RECONCILE_INTERVAL_MS = 30_000;
const DEFAULT_POLL_TIMEOUT_SECONDS = 30;
const DEFAULT_POLL_LIMIT = 25;
const DEFAULT_LEASE_TTL_MS = 45_000;
const DEFAULT_IDLE_DELAY_MS = 5_000;
const DEFAULT_ERROR_BACKOFF_MS = 5_000;
const ALLOWED_UPDATES = ["message", "edited_message"];

function accountFingerprint(config: StoredTelegramChannelConfig): string {
  return JSON.stringify({
    account_key: config.account_key,
    agent_key: config.agent_key ?? null,
    ingress_mode: config.ingress_mode,
    bot_token: config.bot_token ?? null,
    allowed_user_ids: config.allowed_user_ids,
    pipeline_enabled: config.pipeline_enabled,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

class TelegramPollingWorker {
  private stopped = false;
  private loopPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private hasLease = false;
  private clearedWebhookForLease = false;

  constructor(
    private readonly deps: {
      tenantId: string;
      owner: string;
      account: StoredTelegramChannelConfig;
      runtime: TelegramChannelRuntime;
      queue: TelegramChannelQueue;
      agents: AgentRegistry;
      stateDal: TelegramPollingStateDal;
      routingConfigDal?: RoutingConfigDal;
      memoryDal?: MemoryDal;
      logger?: Logger;
      pollTimeoutSeconds: number;
      pollLimit: number;
      leaseTtlMs: number;
      idleDelayMs: number;
      errorBackoffMs: number;
    },
  ) {}

  start(): void {
    if (this.loopPromise) {
      return;
    }
    this.stopped = false;
    this.deps.logger?.info?.("channel.telegram.polling.worker_started", {
      account_key: this.deps.account.account_key,
      owner: this.deps.owner,
    });
    this.loopPromise = this.run();
  }

  stop(): void {
    this.stopped = true;
    this.abortController?.abort();
  }

  async done(): Promise<void> {
    await this.loopPromise;
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      const nowMs = Date.now();
      const acquired = await this.deps.stateDal.tryAcquire({
        tenantId: this.deps.tenantId,
        accountKey: this.deps.account.account_key,
        owner: this.deps.owner,
        nowMs,
        leaseTtlMs: this.deps.leaseTtlMs,
      });
      if (!acquired) {
        if (this.hasLease) {
          this.hasLease = false;
          this.clearedWebhookForLease = false;
          this.deps.logger?.warn("channel.telegram.polling.lease_lost", {
            account_key: this.deps.account.account_key,
            owner: this.deps.owner,
          });
        }
        await sleep(this.deps.idleDelayMs);
        continue;
      }
      if (!this.hasLease) {
        this.hasLease = true;
        this.clearedWebhookForLease = false;
        this.deps.logger?.info?.("channel.telegram.polling.lease_acquired", {
          account_key: this.deps.account.account_key,
          owner: this.deps.owner,
        });
      }

      try {
        await this.pollOnce();
      } catch (err) {
        if (this.stopped) {
          break;
        }
        const message = err instanceof Error ? err.message : String(err);
        const occurredAt = new Date().toISOString();
        this.deps.logger?.warn("channel.telegram.polling.poll_failed", {
          account_key: this.deps.account.account_key,
          error: message,
        });
        await this.deps.stateDal.markError({
          tenantId: this.deps.tenantId,
          accountKey: this.deps.account.account_key,
          owner: this.deps.owner,
          occurredAt,
          message,
        });
        await sleep(this.deps.errorBackoffMs);
      }
    }

    await this.deps.stateDal.release({
      tenantId: this.deps.tenantId,
      accountKey: this.deps.account.account_key,
      owner: this.deps.owner,
    });
    if (this.hasLease) {
      this.deps.logger?.info?.("channel.telegram.polling.lease_released", {
        account_key: this.deps.account.account_key,
        owner: this.deps.owner,
      });
    }
    this.hasLease = false;
    this.clearedWebhookForLease = false;
    this.deps.logger?.info?.("channel.telegram.polling.worker_stopped", {
      account_key: this.deps.account.account_key,
      owner: this.deps.owner,
    });
  }

  private async pollOnce(): Promise<void> {
    const bot = this.deps.runtime.getBotForTelegramAccount({
      tenantId: this.deps.tenantId,
      account: this.deps.account,
    });
    if (!bot) {
      throw new Error("Telegram bot token is required for polling mode");
    }

    const me = await bot.getMe();
    const botUserId = String(me.id);
    const state = await this.deps.stateDal.get({
      tenantId: this.deps.tenantId,
      accountKey: this.deps.account.account_key,
    });
    const polledAt = new Date().toISOString();
    let nextOffset = state?.next_update_id ?? undefined;
    if (state?.bot_user_id && state.bot_user_id !== botUserId) {
      await this.deps.stateDal.resetCursorForBot({
        tenantId: this.deps.tenantId,
        accountKey: this.deps.account.account_key,
        owner: this.deps.owner,
        botUserId,
        polledAt,
      });
      nextOffset = undefined;
      this.deps.logger?.info?.("channel.telegram.polling.bot_identity_changed", {
        account_key: this.deps.account.account_key,
        previous_bot_user_id: state.bot_user_id,
        next_bot_user_id: botUserId,
      });
    } else {
      await this.deps.stateDal.markRunning({
        tenantId: this.deps.tenantId,
        accountKey: this.deps.account.account_key,
        owner: this.deps.owner,
        botUserId,
        polledAt,
      });
    }

    if (!this.clearedWebhookForLease) {
      await bot.deleteWebhook({ drop_pending_updates: false });
      this.clearedWebhookForLease = true;
      this.deps.logger?.info?.("channel.telegram.polling.webhook_deleted", {
        account_key: this.deps.account.account_key,
        owner: this.deps.owner,
      });
    }

    this.abortController?.abort();
    this.abortController = new AbortController();
    const updates = await bot.getUpdates({
      offset: nextOffset,
      limit: this.deps.pollLimit,
      timeout: this.deps.pollTimeoutSeconds,
      allowed_updates: ALLOWED_UPDATES,
      signal: this.abortController.signal,
    });
    const batchPolledAt = new Date().toISOString();
    if (updates.length === 0) {
      await this.deps.stateDal.markRunning({
        tenantId: this.deps.tenantId,
        accountKey: this.deps.account.account_key,
        owner: this.deps.owner,
        botUserId,
        polledAt: batchPolledAt,
      });
      return;
    }

    for (const update of updates) {
      const nextUpdateId = update.update_id + 1;
      try {
        await processTelegramInboundUpdate({
          rawBody: JSON.stringify(update),
          tenantId: this.deps.tenantId,
          account: {
            accountKey: this.deps.account.account_key,
            agentKey: this.deps.account.agent_key,
            allowedUserIds: this.deps.account.allowed_user_ids,
            pipelineEnabled: this.deps.account.pipeline_enabled,
          },
          telegramBot: bot,
          agents: this.deps.agents,
          telegramQueue: this.deps.queue,
          routingConfigDal: this.deps.routingConfigDal,
          memoryDal: this.deps.memoryDal,
          logger: this.deps.logger,
        });
      } catch (err) {
        if (err instanceof TelegramNormalizationError) {
          this.deps.logger?.warn("channel.telegram.polling.update_skipped", {
            account_key: this.deps.account.account_key,
            update_id: update.update_id,
            error: err.message,
          });
          await this.deps.stateDal.updateCursor({
            tenantId: this.deps.tenantId,
            accountKey: this.deps.account.account_key,
            owner: this.deps.owner,
            botUserId,
            nextUpdateId,
            polledAt: new Date().toISOString(),
          });
          this.deps.logger?.info?.("channel.telegram.polling.offset_advanced", {
            account_key: this.deps.account.account_key,
            update_id: update.update_id,
            next_update_id: nextUpdateId,
            reason: "normalization_skipped",
          });
          continue;
        }
        if (err instanceof TelegramInboundTemporaryFailure) {
          this.deps.logger?.warn("channel.telegram.polling.retrying_update", {
            account_key: this.deps.account.account_key,
            update_id: update.update_id,
            error: err.message,
          });
          throw err;
        }
        throw err;
      }

      await this.deps.stateDal.updateCursor({
        tenantId: this.deps.tenantId,
        accountKey: this.deps.account.account_key,
        owner: this.deps.owner,
        botUserId,
        nextUpdateId,
        polledAt: new Date().toISOString(),
      });
      this.deps.logger?.info?.("channel.telegram.polling.offset_advanced", {
        account_key: this.deps.account.account_key,
        update_id: update.update_id,
        next_update_id: nextUpdateId,
        reason: "processed",
      });
    }
  }
}

export class TelegramPollingMonitor {
  private readonly workers = new Map<
    string,
    { fingerprint: string; worker: TelegramPollingWorker }
  >();
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly deps: {
      tenantId?: string;
      owner: string;
      channelConfigDal: ChannelConfigDal;
      runtime: TelegramChannelRuntime;
      queue: TelegramChannelQueue;
      agents: AgentRegistry;
      stateDal: TelegramPollingStateDal;
      routingConfigDal?: RoutingConfigDal;
      memoryDal?: MemoryDal;
      logger?: Logger;
      reconcileIntervalMs?: number;
      pollTimeoutSeconds?: number;
      pollLimit?: number;
      leaseTtlMs?: number;
      idleDelayMs?: number;
      errorBackoffMs?: number;
    },
  ) {}

  start(): void {
    if (this.reconcileTimer) {
      return;
    }
    void this.reconcile();
    this.reconcileTimer = setInterval(() => {
      void this.reconcile();
    }, this.deps.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref?.();
  }

  stop(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    for (const managed of this.workers.values()) {
      managed.worker.stop();
    }
    this.workers.clear();
  }

  private async reconcile(): Promise<void> {
    const tenantId = this.deps.tenantId ?? DEFAULT_TENANT_ID;
    const configs = (await this.deps.channelConfigDal.listTelegram(tenantId)).flatMap((config) =>
      config.ingress_mode === "polling" && config.bot_token?.trim() ? [config] : [],
    );
    const desiredKeys = new Set(configs.map((config) => config.account_key));

    for (const [accountKey, managed] of this.workers.entries()) {
      if (!desiredKeys.has(accountKey)) {
        managed.worker.stop();
        this.workers.delete(accountKey);
        this.deps.logger?.info?.("channel.telegram.polling.worker_removed", {
          account_key: accountKey,
          owner: this.deps.owner,
        });
      }
    }

    for (const config of configs) {
      const fingerprint = accountFingerprint(config);
      const existing = this.workers.get(config.account_key);
      if (existing && existing.fingerprint === fingerprint) {
        continue;
      }
      existing?.worker.stop();
      if (existing) {
        this.deps.logger?.info?.("channel.telegram.polling.worker_restarted", {
          account_key: config.account_key,
          owner: this.deps.owner,
        });
      }
      const worker = new TelegramPollingWorker({
        tenantId,
        owner: this.deps.owner,
        account: config,
        runtime: this.deps.runtime,
        queue: this.deps.queue,
        agents: this.deps.agents,
        stateDal: this.deps.stateDal,
        routingConfigDal: this.deps.routingConfigDal,
        memoryDal: this.deps.memoryDal,
        logger: this.deps.logger,
        pollTimeoutSeconds: this.deps.pollTimeoutSeconds ?? DEFAULT_POLL_TIMEOUT_SECONDS,
        pollLimit: this.deps.pollLimit ?? DEFAULT_POLL_LIMIT,
        leaseTtlMs: this.deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
        idleDelayMs: this.deps.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS,
        errorBackoffMs: this.deps.errorBackoffMs ?? DEFAULT_ERROR_BACKOFF_MS,
      });
      worker.start();
      this.workers.set(config.account_key, { fingerprint, worker });
    }
  }
}
