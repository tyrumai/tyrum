import type { AgentRegistry } from "../agent/registry.js";
import type { MemoryDal } from "../memory/memory-dal.js";
import type { Logger } from "../observability/logger.js";
import type { ArtifactStore } from "../artifact/store.js";
import type { ChannelConfigDal, StoredTelegramChannelConfig } from "./channel-config-dal.js";
import type { RoutingConfigDal } from "./routing-config-dal.js";
import type { TelegramChannelRuntime } from "./telegram-runtime.js";
import type { TelegramChannelQueue } from "./telegram.js";
import { TelegramPollingStateDal } from "./telegram-polling-state-dal.js";
import {
  processTelegramInboundUpdate,
  TelegramInboundTemporaryFailure,
} from "./telegram-inbound.js";
import { TelegramNormalizationError } from "../ingress/telegram.js";
import type { TelegramBot } from "../ingress/telegram-bot.js";
import {
  startTelegramPollingLeaseHeartbeat,
  TelegramPollingWorkerLeaseLostError,
} from "./telegram-polling-lease-heartbeat.js";
import { emitTelegramDebugLog } from "./telegram-debug.js";
import type { IdentityScopeDal } from "../identity/scope.js";

const ALLOWED_UPDATES = ["message", "edited_message", "channel_post", "edited_channel_post"];

class TelegramPollingWorkerConfigChangedError extends Error {
  constructor() {
    super("Telegram polling worker config is no longer active");
    this.name = "TelegramPollingWorkerConfigChangedError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export type TelegramPollingWorkerDeps = {
  tenantId: string;
  owner: string;
  accountKey: string;
  channelConfigDal: ChannelConfigDal;
  runtime: TelegramChannelRuntime;
  queue: TelegramChannelQueue;
  agents: AgentRegistry;
  stateDal: TelegramPollingStateDal;
  routingConfigDal?: RoutingConfigDal;
  identityScopeDal?: IdentityScopeDal;
  memoryDal?: MemoryDal;
  artifactStore?: ArtifactStore;
  logger?: Logger;
  pollTimeoutSeconds: number;
  pollLimit: number;
  leaseTtlMs: number;
  idleDelayMs: number;
  errorBackoffMs: number;
};

export class TelegramPollingWorker {
  private stopped = false;
  private loopPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private hasLease = false;
  private clearedWebhookForLease = false;
  private botIdentityCache: { bot: TelegramBot; botUserId: string } | null = null;

  constructor(private readonly deps: TelegramPollingWorkerDeps) {}

  start(): void {
    if (this.loopPromise) return;
    this.stopped = false;
    this.deps.logger?.info?.("channel.telegram.polling.worker_started", {
      account_key: this.deps.accountKey,
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
        accountKey: this.deps.accountKey,
        owner: this.deps.owner,
        nowMs,
        leaseTtlMs: this.deps.leaseTtlMs,
      });
      if (!acquired) {
        this.markLeaseLost();
        await sleep(this.deps.idleDelayMs);
        continue;
      }
      if (!this.hasLease) {
        this.hasLease = true;
        this.clearedWebhookForLease = false;
        this.deps.logger?.info?.("channel.telegram.polling.lease_acquired", {
          account_key: this.deps.accountKey,
          owner: this.deps.owner,
        });
      }

      try {
        await this.pollOnce();
      } catch (err) {
        if (this.stopped) {
          break;
        }
        if (err instanceof TelegramPollingWorkerConfigChangedError) {
          this.stopped = true;
          this.deps.logger?.info?.("channel.telegram.polling.worker_config_changed", {
            account_key: this.deps.accountKey,
            owner: this.deps.owner,
          });
          break;
        }
        if (err instanceof TelegramPollingWorkerLeaseLostError) {
          this.markLeaseLost();
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        const occurredAt = new Date().toISOString();
        this.deps.logger?.warn("channel.telegram.polling.poll_failed", {
          account_key: this.deps.accountKey,
          error: message,
        });
        await this.deps.stateDal.markError({
          tenantId: this.deps.tenantId,
          accountKey: this.deps.accountKey,
          owner: this.deps.owner,
          occurredAt,
          message,
        });
        await sleep(this.deps.errorBackoffMs);
      }
    }

    await this.deps.stateDal.release({
      tenantId: this.deps.tenantId,
      accountKey: this.deps.accountKey,
      owner: this.deps.owner,
    });
    if (this.hasLease) {
      this.deps.logger?.info?.("channel.telegram.polling.lease_released", {
        account_key: this.deps.accountKey,
        owner: this.deps.owner,
      });
    }
    this.hasLease = false;
    this.clearedWebhookForLease = false;
    this.deps.logger?.info?.("channel.telegram.polling.worker_stopped", {
      account_key: this.deps.accountKey,
      owner: this.deps.owner,
    });
  }

  private async pollOnce(): Promise<void> {
    const leaseHeartbeat = startTelegramPollingLeaseHeartbeat({
      tenantId: this.deps.tenantId,
      accountKey: this.deps.accountKey,
      owner: this.deps.owner,
      stateDal: this.deps.stateDal,
      leaseTtlMs: this.deps.leaseTtlMs,
      abort: () => {
        this.abortController?.abort();
      },
    });
    let primaryError: unknown = null;
    try {
      const pollingAccount = await this.loadPollingAccount();
      const bot = this.deps.runtime.getBotForTelegramAccount({
        tenantId: this.deps.tenantId,
        account: pollingAccount,
      });
      if (!bot) throw new Error("Telegram bot token is required for polling mode");

      const botUserId = await this.getBotUserId(bot);
      const state = await this.deps.stateDal.get({
        tenantId: this.deps.tenantId,
        accountKey: this.deps.accountKey,
      });
      const polledAt = new Date().toISOString();
      let nextOffset = state?.next_update_id ?? undefined;
      if (state?.bot_user_id && state.bot_user_id !== botUserId) {
        await this.deps.stateDal.resetCursorForBot({
          tenantId: this.deps.tenantId,
          accountKey: this.deps.accountKey,
          owner: this.deps.owner,
          botUserId,
          polledAt,
        });
        nextOffset = undefined;
        this.deps.logger?.info?.("channel.telegram.polling.bot_identity_changed", {
          account_key: this.deps.accountKey,
          previous_bot_user_id: state.bot_user_id,
          next_bot_user_id: botUserId,
        });
      } else {
        await this.deps.stateDal.markRunning({
          tenantId: this.deps.tenantId,
          accountKey: this.deps.accountKey,
          owner: this.deps.owner,
          botUserId,
          polledAt,
        });
      }
      leaseHeartbeat.throwIfLeaseLost();

      if (!this.clearedWebhookForLease) {
        await bot.deleteWebhook({ drop_pending_updates: false });
        this.clearedWebhookForLease = true;
        this.deps.logger?.info?.("channel.telegram.polling.webhook_deleted", {
          account_key: this.deps.accountKey,
          owner: this.deps.owner,
        });
      }

      this.abortController?.abort();
      this.abortController = new AbortController();
      emitTelegramDebugLog({
        logger: this.deps.logger,
        enabled: pollingAccount.debug_logging_enabled,
        accountKey: pollingAccount.account_key,
        event: "poll_request",
        fields: {
          owner: this.deps.owner,
          offset: nextOffset,
          limit: this.deps.pollLimit,
          timeout_seconds: this.deps.pollTimeoutSeconds,
          allowed_updates: ALLOWED_UPDATES,
        },
      });
      const updates = await bot.getUpdates({
        offset: nextOffset,
        limit: this.deps.pollLimit,
        timeout: this.deps.pollTimeoutSeconds,
        allowed_updates: ALLOWED_UPDATES,
        signal: this.abortController.signal,
      });
      emitTelegramDebugLog({
        logger: this.deps.logger,
        enabled: pollingAccount.debug_logging_enabled,
        accountKey: pollingAccount.account_key,
        event: "poll_result",
        fields: {
          owner: this.deps.owner,
          offset: nextOffset,
          update_count: updates.length,
          updates,
        },
      });
      leaseHeartbeat.throwIfLeaseLost();

      const batchPolledAt = new Date().toISOString();
      if (updates.length === 0) {
        await this.deps.stateDal.markRunning({
          tenantId: this.deps.tenantId,
          accountKey: this.deps.accountKey,
          owner: this.deps.owner,
          botUserId,
          polledAt: batchPolledAt,
        });
        leaseHeartbeat.throwIfLeaseLost();
        return;
      }

      for (const update of updates) {
        leaseHeartbeat.throwIfLeaseLost();
        const currentAccount = await this.loadPollingAccount();
        const currentBot = this.deps.runtime.getBotForTelegramAccount({
          tenantId: this.deps.tenantId,
          account: currentAccount,
        });
        if (!currentBot) throw new Error("Telegram bot token is required for polling mode");
        const nextUpdateId = update.update_id + 1;
        try {
          await processTelegramInboundUpdate({
            rawBody: JSON.stringify(update),
            transport: "polling",
            tenantId: this.deps.tenantId,
            account: {
              accountKey: currentAccount.account_key,
              agentKey: currentAccount.agent_key,
              allowedUserIds: currentAccount.allowed_user_ids,
              pipelineEnabled: currentAccount.pipeline_enabled,
              debugLoggingEnabled: currentAccount.debug_logging_enabled,
            },
            telegramBot: currentBot,
            agents: this.deps.agents,
            telegramQueue: this.deps.queue,
            routingConfigDal: this.deps.routingConfigDal,
            identityScopeDal: this.deps.identityScopeDal,
            memoryDal: this.deps.memoryDal,
            artifactStore: this.deps.artifactStore,
            logger: this.deps.logger,
          });
        } catch (err) {
          if (err instanceof TelegramNormalizationError) {
            this.deps.logger?.warn("channel.telegram.polling.update_skipped", {
              account_key: this.deps.accountKey,
              update_id: update.update_id,
              error: err.message,
            });
            emitTelegramDebugLog({
              logger: this.deps.logger,
              enabled: currentAccount.debug_logging_enabled,
              accountKey: currentAccount.account_key,
              event: "drop",
              fields: {
                transport: "polling",
                reason: "normalization_error",
                update_id: update.update_id,
                error: err.message,
              },
            });
            leaseHeartbeat.throwIfLeaseLost();
            await this.deps.stateDal.updateCursor({
              tenantId: this.deps.tenantId,
              accountKey: this.deps.accountKey,
              owner: this.deps.owner,
              botUserId,
              nextUpdateId,
              polledAt: new Date().toISOString(),
            });
            leaseHeartbeat.throwIfLeaseLost();
            this.deps.logger?.info?.("channel.telegram.polling.offset_advanced", {
              account_key: this.deps.accountKey,
              update_id: update.update_id,
              next_update_id: nextUpdateId,
              reason: "normalization_skipped",
            });
            emitTelegramDebugLog({
              logger: this.deps.logger,
              enabled: currentAccount.debug_logging_enabled,
              accountKey: currentAccount.account_key,
              event: "poll_cursor_advanced",
              fields: {
                update_id: update.update_id,
                next_update_id: nextUpdateId,
                reason: "normalization_skipped",
              },
            });
            continue;
          }
          if (err instanceof TelegramInboundTemporaryFailure) {
            this.deps.logger?.warn("channel.telegram.polling.retrying_update", {
              account_key: this.deps.accountKey,
              update_id: update.update_id,
              error: err.message,
            });
            emitTelegramDebugLog({
              logger: this.deps.logger,
              enabled: currentAccount.debug_logging_enabled,
              accountKey: currentAccount.account_key,
              event: "poll_retrying_update",
              fields: {
                update_id: update.update_id,
                error: err.message,
              },
            });
            throw err;
          }
          throw err;
        }

        leaseHeartbeat.throwIfLeaseLost();
        await this.deps.stateDal.updateCursor({
          tenantId: this.deps.tenantId,
          accountKey: this.deps.accountKey,
          owner: this.deps.owner,
          botUserId,
          nextUpdateId,
          polledAt: new Date().toISOString(),
        });
        leaseHeartbeat.throwIfLeaseLost();
        this.deps.logger?.info?.("channel.telegram.polling.offset_advanced", {
          account_key: this.deps.accountKey,
          update_id: update.update_id,
          next_update_id: nextUpdateId,
          reason: "processed",
        });
        emitTelegramDebugLog({
          logger: this.deps.logger,
          enabled: currentAccount.debug_logging_enabled,
          accountKey: currentAccount.account_key,
          event: "poll_cursor_advanced",
          fields: {
            update_id: update.update_id,
            next_update_id: nextUpdateId,
            reason: "processed",
          },
        });
      }
    } catch (err) {
      primaryError = err;
      throw err;
    } finally {
      await leaseHeartbeat.stop({ suppressThrow: primaryError !== null });
    }
  }

  private markLeaseLost(): void {
    if (!this.hasLease) return;
    this.hasLease = false;
    this.clearedWebhookForLease = false;
    this.deps.logger?.warn("channel.telegram.polling.lease_lost", {
      account_key: this.deps.accountKey,
      owner: this.deps.owner,
    });
  }

  private async loadPollingAccount(): Promise<StoredTelegramChannelConfig> {
    const account = await this.deps.channelConfigDal.getTelegramByAccountKey({
      tenantId: this.deps.tenantId,
      accountKey: this.deps.accountKey,
    });
    if (!account || account.ingress_mode !== "polling" || !account.bot_token?.trim()) {
      throw new TelegramPollingWorkerConfigChangedError();
    }
    return account;
  }

  private async getBotUserId(bot: TelegramBot): Promise<string> {
    if (this.botIdentityCache?.bot === bot) {
      return this.botIdentityCache.botUserId;
    }

    const me = await bot.getMe();
    const botUserId = String(me.id);
    this.botIdentityCache = { bot, botUserId };
    return botUserId;
  }
}
