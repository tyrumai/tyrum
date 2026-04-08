import type { AgentRegistry } from "../agent/registry.js";
import type { ArtifactStore } from "../artifact/store.js";
import { DEFAULT_TENANT_ID, type IdentityScopeDal } from "../identity/scope.js";
import type { MemoryDal } from "../memory/memory-dal.js";
import type { Logger } from "../observability/logger.js";
import type { ChannelConfigDal, StoredTelegramChannelConfig } from "./channel-config-dal.js";
import type { RoutingConfigDal } from "./routing-config-dal.js";
import type { TelegramChannelRuntime } from "./telegram-runtime.js";
import type { TelegramChannelQueue } from "./telegram.js";
import { TelegramPollingStateDal } from "./telegram-polling-state-dal.js";
import { TelegramPollingWorker } from "./telegram-polling-worker.js";

const DEFAULT_RECONCILE_INTERVAL_MS = 30_000;
const DEFAULT_POLL_TIMEOUT_SECONDS = 30;
const DEFAULT_POLL_LIMIT = 25;
const DEFAULT_LEASE_TTL_MS = 45_000;
const DEFAULT_IDLE_DELAY_MS = 5_000;
const DEFAULT_ERROR_BACKOFF_MS = 5_000;

function accountFingerprint(config: StoredTelegramChannelConfig): string {
  return JSON.stringify({
    account_key: config.account_key,
    agent_key: config.agent_key ?? null,
    ingress_mode: config.ingress_mode,
    bot_token: config.bot_token ?? null,
    allowed_user_ids: config.allowed_user_ids,
    pipeline_enabled: config.pipeline_enabled,
    debug_logging_enabled: config.debug_logging_enabled,
  });
}

export class TelegramPollingMonitor {
  private readonly workers = new Map<
    string,
    { fingerprint: string; worker: TelegramPollingWorker }
  >();
  private readonly workerShutdowns = new Set<Promise<void>>();
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private reconcilePromise: Promise<void> | null = null;
  private running = false;

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
      identityScopeDal?: IdentityScopeDal;
      memoryDal?: MemoryDal;
      artifactStore?: ArtifactStore;
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
    if (this.running) return;
    this.running = true;
    this.scheduleReconcile();
    this.reconcileTimer = setInterval(
      () => this.scheduleReconcile(),
      this.deps.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS,
    );
    this.reconcileTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    await this.reconcilePromise;
    const workers = Array.from(this.workers.values(), ({ worker }) => worker);
    this.workers.clear();
    for (const worker of workers) {
      this.trackWorkerShutdown(worker);
    }
    await Promise.allSettled(this.workerShutdowns);
  }

  private scheduleReconcile(): void {
    if (!this.running || this.reconcilePromise) return;
    const reconcilePromise = this.reconcile().finally(() => {
      if (this.reconcilePromise === reconcilePromise) {
        this.reconcilePromise = null;
      }
    });
    this.reconcilePromise = reconcilePromise;
  }

  private async reconcile(): Promise<void> {
    if (!this.running) return;
    const tenantId = this.deps.tenantId ?? DEFAULT_TENANT_ID;
    const configs = (await this.deps.channelConfigDal.listTelegram(tenantId)).flatMap((config) =>
      config.ingress_mode === "polling" && config.bot_token?.trim() ? [config] : [],
    );
    if (!this.running) return;
    const desiredKeys = new Set(configs.map((config) => config.account_key));

    for (const [accountKey, managed] of this.workers.entries()) {
      if (!desiredKeys.has(accountKey)) {
        this.trackWorkerShutdown(managed.worker);
        this.workers.delete(accountKey);
        this.deps.logger?.info?.("channel.telegram.polling.worker_removed", {
          account_key: accountKey,
          owner: this.deps.owner,
        });
      }
    }

    for (const config of configs) {
      if (!this.running) return;
      const fingerprint = accountFingerprint(config);
      const existing = this.workers.get(config.account_key);
      if (existing && existing.fingerprint === fingerprint) {
        continue;
      }
      if (existing) {
        this.trackWorkerShutdown(existing.worker);
        this.deps.logger?.info?.("channel.telegram.polling.worker_restarted", {
          account_key: config.account_key,
          owner: this.deps.owner,
        });
      }
      const worker = new TelegramPollingWorker({
        tenantId,
        owner: this.deps.owner,
        accountKey: config.account_key,
        channelConfigDal: this.deps.channelConfigDal,
        runtime: this.deps.runtime,
        queue: this.deps.queue,
        agents: this.deps.agents,
        stateDal: this.deps.stateDal,
        routingConfigDal: this.deps.routingConfigDal,
        identityScopeDal: this.deps.identityScopeDal,
        memoryDal: this.deps.memoryDal,
        artifactStore: this.deps.artifactStore,
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

  private trackWorkerShutdown(worker: TelegramPollingWorker): void {
    worker.stop();
    const donePromise = worker.done().finally(() => {
      this.workerShutdowns.delete(donePromise);
    });
    this.workerShutdowns.add(donePromise);
  }
}
