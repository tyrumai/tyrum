/**
 * Watcher scheduler — periodic tick for time-based watchers.
 *
 * Queries active periodic watchers on each tick, creates a durable firing
 * record (deduped per watcher+slot), and then processes queued firings with
 * DB-lease ownership for cluster safety.
 */

import type { Emitter } from "mitt";
import type { GatewayEvents } from "../../event-bus.js";
import type {
  ActionPrimitive,
  Lane as LaneT,
  Playbook,
  PolicyBundle as PolicyBundleT,
} from "@tyrum/schemas";
import { ActionPrimitive as ActionPrimitiveSchema, Lane, PolicyBundle } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import type { MemoryV1Dal } from "../memory/v1-dal.js";
import { recordMemoryV1SystemEpisode } from "../memory/v1-episode-recorder.js";
import type { Logger } from "../observability/logger.js";
import type { ExecutionEngine } from "../execution/engine.js";
import type { PolicyService } from "../policy/service.js";
import type { PlaybookRunner } from "../playbook/runner.js";
import { WatcherFiringDal, type WatcherFiringRow } from "./firing-dal.js";

const DEFAULT_TICK_MS = 60_000;
const DEFAULT_FIRING_LEASE_TTL_MS = 60_000;
const DEFAULT_PROCESS_BATCH = 25;

class LostFiringLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LostFiringLeaseError";
  }
}

interface RawPeriodicWatcherRow {
  id: number;
  plan_id: string;
  trigger_type: string;
  trigger_config: string;
  active: number;
  last_fired_at_ms?: number | null;
  workspace_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PeriodicTriggerConfig {
  intervalMs: number;
  playbook_id?: string;
  key?: string;
  lane?: LaneT;
  laneRaw?: string;
  steps?: unknown;
}

export interface WatcherSchedulerOptions {
  db: SqlDb;
  memoryV1Dal: MemoryV1Dal;
  eventBus: Emitter<GatewayEvents>;
  owner?: string;
  logger?: Logger;
  engine?: ExecutionEngine;
  policyService?: PolicyService;
  playbooks?: Playbook[];
  playbookRunner?: PlaybookRunner;
  tickMs?: number;
  firingLeaseTtlMs?: number;
  maxFiringsPerTick?: number;
  /**
   * When true, the scheduler interval will keep the Node.js process alive.
   * Defaults to false so background scheduling doesn't block graceful shutdown.
   */
  keepProcessAlive?: boolean;
}

export class WatcherScheduler {
  private readonly db: SqlDb;
  private readonly memoryV1Dal: MemoryV1Dal;
  private readonly eventBus: Emitter<GatewayEvents>;
  private readonly owner: string;
  private readonly logger?: Logger;
  private readonly tickMs: number;
  private readonly keepProcessAlive: boolean;
  private readonly firingLeaseTtlMs: number;
  private readonly maxFiringsPerTick: number;
  private readonly firingDal: WatcherFiringDal;
  private readonly engine?: ExecutionEngine;
  private readonly policyService?: PolicyService;
  private readonly playbookRunner?: PlaybookRunner;
  private readonly playbooksById: Map<string, Playbook>;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: WatcherSchedulerOptions) {
    this.db = opts.db;
    this.memoryV1Dal = opts.memoryV1Dal;
    this.eventBus = opts.eventBus;
    this.owner = opts.owner?.trim() || "scheduler";
    this.logger = opts.logger;
    this.tickMs = opts.tickMs ?? DEFAULT_TICK_MS;
    this.keepProcessAlive = opts.keepProcessAlive ?? false;
    this.firingLeaseTtlMs = opts.firingLeaseTtlMs ?? DEFAULT_FIRING_LEASE_TTL_MS;
    this.maxFiringsPerTick = Math.max(
      1,
      Math.min(500, opts.maxFiringsPerTick ?? DEFAULT_PROCESS_BATCH),
    );
    this.firingDal = new WatcherFiringDal(opts.db);
    this.engine = opts.engine;
    this.policyService = opts.policyService;
    this.playbookRunner = opts.playbookRunner;
    this.playbooksById = new Map((opts.playbooks ?? []).map((p) => [p.manifest.id, p]));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error("watcher.scheduler_tick_failed", { error: message });
      });
    }, this.tickMs);
    if (!this.keepProcessAlive) {
      // Don't prevent process exit (useful in embedded / test scenarios).
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Exposed for testing -- runs one scheduler cycle. */
  async tick(): Promise<void> {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const watchers = await this.getActivePeriodicWatchers();
    for (const watcher of watchers) {
      const config = this.parsePeriodicConfig(watcher.trigger_config);
      if (!config) continue;
      const slotMs = this.computeSlot(now, config.intervalMs);
      const lastFiredAt = watcher.last_fired_at_ms ?? 0;
      if (slotMs <= lastFiredAt) continue;

      const firingId = `firing-${String(watcher.id)}-${String(slotMs)}`;
      try {
        const created = await this.firingDal.createIfAbsent({
          firingId,
          watcherId: watcher.id,
          planId: watcher.plan_id,
          triggerType: "periodic",
          scheduledAtMs: slotMs,
        });

        // Best-effort: advance watcher cursor even if the firing already existed.
        await this.db.run(
          `UPDATE watchers
           SET last_fired_at_ms = ?, updated_at = ?
           WHERE id = ? AND trigger_type = 'periodic' AND active = 1
             AND (last_fired_at_ms IS NULL OR last_fired_at_ms < ?)`,
          [slotMs, nowIso, watcher.id, slotMs],
        );

        if (created.created) {
          this.logger?.info("watcher.firing_created", {
            watcher_id: watcher.id,
            plan_id: watcher.plan_id,
            firing_id: firingId,
            scheduled_at_ms: slotMs,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.warn("watcher.firing_create_failed", {
          watcher_id: watcher.id,
          plan_id: watcher.plan_id,
          error: message,
        });
      }
    }

    let processed = 0;
    while (processed < this.maxFiringsPerTick) {
      const firing = await this.firingDal.claimNext({
        owner: this.owner,
        nowMs: Date.now(),
        leaseTtlMs: this.firingLeaseTtlMs,
      });
      if (!firing) break;
      await this.processFiring(firing);
      processed += 1;
    }
  }

  private async getActivePeriodicWatchers(): Promise<RawPeriodicWatcherRow[]> {
    return await this.db.all<RawPeriodicWatcherRow>(
      "SELECT * FROM watchers WHERE trigger_type = 'periodic' AND active = 1",
    );
  }

  private parsePeriodicConfig(raw: string): PeriodicTriggerConfig | undefined {
    let cfg: unknown;
    try {
      cfg = JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
    if (!cfg || typeof cfg !== "object") return undefined;
    const intervalMs = (cfg as Record<string, unknown>)["intervalMs"];
    if (typeof intervalMs !== "number" || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      return undefined;
    }
    const playbookId = (cfg as Record<string, unknown>)["playbook_id"];
    const key = (cfg as Record<string, unknown>)["key"];
    const lane = (cfg as Record<string, unknown>)["lane"];
    const steps = (cfg as Record<string, unknown>)["steps"];
    return {
      intervalMs: Math.floor(intervalMs),
      playbook_id:
        typeof playbookId === "string" && playbookId.trim().length > 0
          ? playbookId.trim()
          : undefined,
      key: typeof key === "string" && key.trim().length > 0 ? key.trim() : undefined,
      lane: (() => {
        if (typeof lane !== "string") return undefined;
        const trimmed = lane.trim();
        if (!trimmed) return undefined;
        const normalized = trimmed.toLowerCase();
        const parsed = Lane.safeParse(normalized);
        return parsed.success ? parsed.data : undefined;
      })(),
      laneRaw: (() => {
        if (typeof lane !== "string") return undefined;
        const trimmed = lane.trim();
        return trimmed ? trimmed : undefined;
      })(),
      steps,
    };
  }

  private computeSlot(nowMs: number, intervalMs: number): number {
    const intv = Math.max(1, Math.floor(intervalMs));
    return Math.floor(nowMs / intv) * intv;
  }

  private isAutomationExecutionEnabled(): boolean {
    const raw = process.env["TYRUM_AUTOMATION_ENABLED"]?.trim().toLowerCase();
    return Boolean(raw && !["0", "false", "off", "no"].includes(raw));
  }

  private resolvePlaybookBundle(playbook: Playbook): PolicyBundleT | undefined {
    const allowed = playbook.manifest.allowed_domains ?? [];
    if (!Array.isArray(allowed) || allowed.length === 0) return undefined;
    return PolicyBundle.parse({
      v: 1,
      network_egress: {
        default: "require_approval",
        allow: allowed.flatMap((d) => [`https://${d}/*`, `http://${d}/*`]),
        require_approval: [],
        deny: [],
      },
    });
  }

  private parseInlineSteps(raw: unknown): ActionPrimitive[] | undefined {
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    const out: ActionPrimitive[] = [];
    for (const entry of raw) {
      const parsed = ActionPrimitiveSchema.safeParse(entry);
      if (!parsed.success) return undefined;
      out.push(parsed.data);
    }
    return out;
  }

  private async processFiring(firing: WatcherFiringRow): Promise<void> {
    if (firing.trigger_type === "webhook") {
      // Webhook firings already have an operator-visible episode recorded at ingestion time.
      // The scheduler's responsibility is to lease + finalize the durable firing row.
      if (!this.isAutomationExecutionEnabled()) {
        await this.firingDal.markEnqueued({ firingId: firing.firing_id, owner: this.owner });
        return;
      }

      // Automation execution is enabled, but webhook-triggered automation is not yet wired here.
      await this.firingDal.markFailed({
        firingId: firing.firing_id,
        owner: this.owner,
        error: "webhook-triggered automation execution is not configured",
      });
      return;
    }

    const occurredAtIso = new Date(firing.scheduled_at_ms).toISOString();
    try {
      await recordMemoryV1SystemEpisode(
        this.memoryV1Dal,
        {
          occurred_at: occurredAtIso,
          channel: "watcher",
          event_type: "periodic_fired",
          summary_md: `Watcher fired: periodic_fired`,
          tags: ["watcher", `watcher_id:${String(firing.watcher_id)}`, `plan_id:${firing.plan_id}`],
          metadata: {
            firing_id: firing.firing_id,
            watcher_id: firing.watcher_id,
            plan_id: firing.plan_id,
            trigger_type: firing.trigger_type,
            scheduled_at_ms: firing.scheduled_at_ms,
          },
        },
        "default",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("watcher.periodic_episode_record_failed", {
        watcher_id: firing.watcher_id,
        plan_id: firing.plan_id,
        firing_id: firing.firing_id,
        error: message,
      });
    }

    this.eventBus.emit("watcher:fired", {
      watcherId: firing.watcher_id,
      planId: firing.plan_id,
      triggerType: firing.trigger_type,
    });

    // If automation execution isn't enabled (default), mark the firing as handled.
    if (!this.isAutomationExecutionEnabled()) {
      await this.firingDal.markEnqueued({ firingId: firing.firing_id, owner: this.owner });
      return;
    }

    if (!this.engine || !this.policyService) {
      await this.firingDal.markFailed({
        firingId: firing.firing_id,
        owner: this.owner,
        error: "automation enabled but execution engine/policy service not configured",
      });
      return;
    }

    const watcherRow = await this.db.get<{ trigger_config: string }>(
      "SELECT trigger_config FROM watchers WHERE id = ?",
      [firing.watcher_id],
    );
    const cfg = watcherRow ? this.parsePeriodicConfig(watcherRow.trigger_config) : undefined;

    const key = cfg?.key ?? `cron:watcher-${String(firing.watcher_id)}`;
    if (cfg?.laneRaw && !cfg.lane) {
      await this.firingDal.markFailed({
        firingId: firing.firing_id,
        owner: this.owner,
        error: `invalid periodic watcher lane '${cfg.laneRaw}'`,
      });
      return;
    }

    const lane = cfg?.lane ?? "cron";
    const playbookId = cfg?.playbook_id ?? firing.plan_id;

    let steps: ActionPrimitive[] | undefined = cfg?.steps
      ? this.parseInlineSteps(cfg.steps)
      : undefined;
    let playbook: Playbook | undefined;

    if (!steps) {
      playbook = this.playbooksById.get(playbookId);
      if (!playbook) {
        await this.firingDal.markFailed({
          firingId: firing.firing_id,
          owner: this.owner,
          error: `playbook '${playbookId}' not found (set trigger_config.playbook_id or supply trigger_config.steps)`,
        });
        return;
      }
      if (!this.playbookRunner) {
        await this.firingDal.markFailed({
          firingId: firing.firing_id,
          owner: this.owner,
          error: "playbook runner not configured",
        });
        return;
      }
      steps = this.playbookRunner.run(playbook).steps;
    }

    const planId = `automation-${firing.firing_id}`;
    const requestId = `automation-${firing.firing_id}`;

    const playbookBundle = playbook ? this.resolvePlaybookBundle(playbook) : undefined;
    const effective = await this.policyService.loadEffectiveBundle({ playbookBundle });
    const snapshot = await this.policyService.getOrCreateSnapshot(effective.bundle);

    try {
      const result = await this.db.transaction(async (tx) => {
        // Ensure we still own this firing before enqueuing.
        const current = await tx.get<{ status: string; lease_owner: string | null }>(
          "SELECT status, lease_owner FROM watcher_firings WHERE firing_id = ?",
          [firing.firing_id],
        );
        if (!current || current.status !== "processing" || current.lease_owner !== this.owner) {
          return null;
        }

        const enqueued = await this.engine!.enqueuePlanInTx(tx, {
          key,
          lane,
          planId,
          requestId,
          steps: steps!,
          policySnapshotId: snapshot.policy_snapshot_id,
          trigger: {
            kind: lane === "heartbeat" ? "heartbeat" : "cron",
            key,
            lane,
            metadata: {
              firing_id: firing.firing_id,
              watcher_id: firing.watcher_id,
              plan_id: firing.plan_id,
              trigger_type: firing.trigger_type,
              scheduled_at_ms: firing.scheduled_at_ms,
              lease_owner: firing.lease_owner,
              lease_expires_at_ms: firing.lease_expires_at_ms,
            },
          },
        });

        const updated = await tx.run(
          `UPDATE watcher_firings
           SET status = 'enqueued',
               lease_owner = NULL,
               lease_expires_at_ms = NULL,
               job_id = ?,
               run_id = ?,
               error = NULL,
               updated_at = ?
           WHERE firing_id = ? AND lease_owner = ? AND status = 'processing'`,
          [enqueued.jobId, enqueued.runId, new Date().toISOString(), firing.firing_id, this.owner],
        );
        if (updated.changes !== 1) {
          throw new LostFiringLeaseError("lost watcher firing lease while enqueuing");
        }
        return enqueued;
      });

      if (!result) {
        // Lost lease; no-op.
        return;
      }

      this.logger?.info("watcher.firing_enqueued", {
        firing_id: firing.firing_id,
        watcher_id: firing.watcher_id,
        job_id: result.jobId,
        run_id: result.runId,
      });
    } catch (err) {
      if (err instanceof LostFiringLeaseError) {
        // Another scheduler likely took over; we rolled back any partial writes.
        this.logger?.debug("watcher.firing_lost_lease", {
          firing_id: firing.firing_id,
          watcher_id: firing.watcher_id,
          error: err.message,
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      await this.firingDal.markFailed({
        firingId: firing.firing_id,
        owner: this.owner,
        error: message,
      });
      this.logger?.warn("watcher.firing_process_failed", {
        firing_id: firing.firing_id,
        watcher_id: firing.watcher_id,
        error: message,
      });
    }
  }
}
