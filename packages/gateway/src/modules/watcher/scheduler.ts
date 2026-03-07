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
import { ActionPrimitive as ActionPrimitiveSchema, PolicyBundle } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { sqlActiveWhereClause } from "../../statestore/sql.js";
import type { MemoryV1Dal } from "../memory/v1-dal.js";
import { recordMemoryV1SystemEpisode } from "../memory/v1-episode-recorder.js";
import type { Logger } from "../observability/logger.js";
import type { ExecutionEngine } from "../execution/engine.js";
import type { PolicyService } from "../policy/service.js";
import type { PlaybookRunner } from "../playbook/runner.js";
import { WatcherFiringDal, type WatcherFiringRow } from "./firing-dal.js";
import {
  defaultHeartbeatInstruction,
  parseScheduleConfig,
  resolvePendingScheduleFireMs,
  type NormalizedScheduleConfig,
} from "../automation/schedule-service.js";

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
  tenant_id: string;
  watcher_id: string;
  watcher_key: string;
  agent_id: string;
  workspace_id: string;
  trigger_type: string;
  trigger_config_json: string;
  active: number | boolean;
  last_fired_at_ms?: number | null;
  created_at: string;
  updated_at: string;
}

type SchedulerPeriodicConfig = Omit<NormalizedScheduleConfig, "lane"> & {
  lane?: LaneT;
  laneRaw?: string;
};

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
  /** Enables execution of watchers via the execution engine (default: false). */
  automationEnabled?: boolean;
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
  private readonly automationEnabled: boolean;
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
    this.automationEnabled = opts.automationEnabled ?? false;
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
    const activeWhere = sqlActiveWhereClause(this.db);

    const watchers = await this.getActivePeriodicWatchers();
    for (const watcher of watchers) {
      const config = this.parsePeriodicConfig(watcher.trigger_config_json);
      if (!config) continue;
      const slotMs = resolvePendingScheduleFireMs({
        config: {
          ...config,
          lane: config.lane ?? "cron",
        },
        lastFiredAtMs: watcher.last_fired_at_ms ?? null,
        nowMs: now,
      });
      if (slotMs === undefined) continue;

      try {
        const created = await this.firingDal.createIfAbsent({
          tenantId: watcher.tenant_id,
          watcherId: watcher.watcher_id,
          scheduledAtMs: slotMs,
        });

        // Best-effort: advance watcher cursor even if the firing already existed.
        await this.db.run(
          `UPDATE watchers
           SET last_fired_at_ms = ?, updated_at = ?
           WHERE tenant_id = ? AND watcher_id = ? AND trigger_type = 'periodic' AND ${activeWhere.sql}
             AND (last_fired_at_ms IS NULL OR last_fired_at_ms < ?)`,
          [slotMs, nowIso, watcher.tenant_id, watcher.watcher_id, ...activeWhere.params, slotMs],
        );

        if (created.created) {
          this.logger?.info("watcher.firing_created", {
            watcher_id: watcher.watcher_id,
            schedule_kind: config.schedule_kind,
            firing_id: created.row.watcher_firing_id,
            scheduled_at_ms: slotMs,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.warn("watcher.firing_create_failed", {
          watcher_id: watcher.watcher_id,
          schedule_kind: config.schedule_kind,
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
    const activeWhere = sqlActiveWhereClause(this.db);
    return await this.db.all<RawPeriodicWatcherRow>(
      `SELECT *
       FROM watchers
       WHERE trigger_type = 'periodic' AND ${activeWhere.sql}`,
      activeWhere.params,
    );
  }

  private parsePeriodicConfig(raw: string): SchedulerPeriodicConfig | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      // Intentional: malformed watcher configs are ignored so one bad row does not break scheduling.
      return undefined;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const record = parsed as Record<string, unknown>;
    const laneRaw = typeof record["lane"] === "string" ? record["lane"].trim() : undefined;
    const parsedLane = laneRaw === "heartbeat" || laneRaw === "cron" ? laneRaw : undefined;
    const normalized = parseScheduleConfig(raw);
    if (normalized) {
      if (laneRaw && !parsedLane && record["schedule_kind"] === undefined) {
        return { ...normalized, lane: undefined, laneRaw };
      }
      return { ...normalized, laneRaw };
    }

    const intervalMs = record["intervalMs"];
    if (typeof intervalMs !== "number" || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      return undefined;
    }

    let execution: NormalizedScheduleConfig["execution"] | undefined;
    if (Array.isArray(record["steps"])) {
      const steps: ActionPrimitive[] = [];
      for (const entry of record["steps"]) {
        const parsedStep = ActionPrimitiveSchema.safeParse(entry);
        if (!parsedStep.success) return undefined;
        steps.push(parsedStep.data);
      }
      if (steps.length > 0) {
        execution = { kind: "steps", steps };
      }
    }
    if (!execution) {
      const playbookId =
        typeof record["playbook_id"] === "string"
          ? record["playbook_id"].trim()
          : typeof record["planId"] === "string"
            ? record["planId"].trim()
            : "";
      if (playbookId) {
        execution = { kind: "playbook", playbook_id: playbookId };
      }
    }
    if (!execution) {
      return undefined;
    }

    return {
      v: 1,
      schedule_kind: parsedLane === "heartbeat" ? "heartbeat" : "cron",
      enabled: record["enabled"] === false ? false : true,
      cadence: { type: "interval", interval_ms: Math.floor(intervalMs) },
      execution,
      delivery: { mode: parsedLane === "heartbeat" ? "quiet" : "notify" },
      ...(typeof record["key"] === "string" && record["key"].trim()
        ? { key: record["key"].trim() }
        : {}),
      ...(parsedLane ? { lane: parsedLane } : {}),
      laneRaw,
    };
  }

  private isAutomationExecutionEnabled(): boolean {
    return this.automationEnabled;
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

  private buildAutomationTurnRequest(input: {
    watcher: RawPeriodicWatcherRow;
    firing: WatcherFiringRow;
    config: SchedulerPeriodicConfig;
    tenantKey: string;
    agentKey: string;
    workspaceKey: string;
  }): Record<string, unknown> {
    const kind = input.config.schedule_kind;
    const instruction =
      input.config.execution.kind === "agent_turn"
        ? input.config.execution.instruction?.trim() || defaultHeartbeatInstruction()
        : undefined;
    const previousFiredAtIso = input.watcher.last_fired_at_ms
      ? new Date(input.watcher.last_fired_at_ms).toISOString()
      : null;
    const firedAtIso = new Date(input.firing.scheduled_at_ms).toISOString();

    const messageLines = [
      `Automation trigger: ${kind}`,
      `Schedule id: ${input.watcher.watcher_id}`,
      `Watcher key: ${input.watcher.watcher_key}`,
      `Fired at: ${firedAtIso}`,
      `Previous fired at: ${previousFiredAtIso ?? "never"}`,
      `Delivery mode: ${input.config.delivery.mode}`,
      `Cadence: ${
        input.config.cadence.type === "interval"
          ? `every ${String(input.config.cadence.interval_ms)}ms`
          : `${input.config.cadence.expression} (${input.config.cadence.timezone})`
      }`,
      "",
      "Instruction:",
      instruction ?? "Review context and act according to the configured automation schedule.",
    ];
    if (kind === "heartbeat" && input.config.delivery.mode === "quiet") {
      messageLines.push("", "Return an empty reply when there is no useful user-facing action.");
    }

    return {
      tenant_key: input.tenantKey,
      agent_key: input.agentKey,
      workspace_key: input.workspaceKey,
      channel: "automation:default",
      thread_id: `schedule-${input.watcher.watcher_id}`,
      container_kind: "channel",
      message: messageLines.join("\n"),
      metadata: {
        automation: {
          schedule_id: input.watcher.watcher_id,
          watcher_key: input.watcher.watcher_key,
          schedule_kind: kind,
          fired_at: firedAtIso,
          previous_fired_at: previousFiredAtIso,
          cadence: input.config.cadence,
          delivery_mode: input.config.delivery.mode,
          seeded_default: input.config.seeded_default === true,
          instruction,
        },
      },
    };
  }

  private async processFiring(firing: WatcherFiringRow): Promise<void> {
    const watcher = await this.db.get<RawPeriodicWatcherRow>(
      `SELECT *
       FROM watchers
       WHERE tenant_id = ? AND watcher_id = ? LIMIT 1`,
      [firing.tenant_id, firing.watcher_id],
    );
    if (!watcher) {
      await this.firingDal.markFailed({
        tenantId: firing.tenant_id,
        watcherFiringId: firing.watcher_firing_id,
        owner: this.owner,
        error: "watcher not found",
      });
      return;
    }

    const triggerType = watcher.trigger_type;
    const cfg = this.parsePeriodicConfig(watcher.trigger_config_json);
    const planId =
      cfg?.execution.kind === "playbook"
        ? cfg.execution.playbook_id
        : cfg?.execution.kind === "agent_turn"
          ? cfg.schedule_kind
          : "";

    if (triggerType === "webhook") {
      // Webhook firings already have an operator-visible episode recorded at ingestion time.
      // The scheduler's responsibility is to lease + finalize the durable firing row.
      if (!this.isAutomationExecutionEnabled()) {
        await this.firingDal.markEnqueued({
          tenantId: firing.tenant_id,
          watcherFiringId: firing.watcher_firing_id,
          owner: this.owner,
        });
        return;
      }

      // Automation execution is enabled, but webhook-triggered automation is not yet wired here.
      await this.firingDal.markFailed({
        tenantId: firing.tenant_id,
        watcherFiringId: firing.watcher_firing_id,
        owner: this.owner,
        error: "webhook-triggered automation execution is not configured",
      });
      return;
    }

    if (triggerType !== "periodic") {
      await this.firingDal.markFailed({
        tenantId: firing.tenant_id,
        watcherFiringId: firing.watcher_firing_id,
        owner: this.owner,
        error: `unexpected watcher trigger type '${triggerType}'`,
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
          tags: ["watcher", `watcher_id:${firing.watcher_id}`, `plan_id:${planId}`],
          metadata: {
            firing_id: firing.watcher_firing_id,
            watcher_id: firing.watcher_id,
            plan_id: planId,
            trigger_type: triggerType,
            scheduled_at_ms: firing.scheduled_at_ms,
          },
        },
        { tenantId: firing.tenant_id, agentId: watcher.agent_id },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("watcher.periodic_episode_record_failed", {
        watcher_id: firing.watcher_id,
        plan_id: planId,
        firing_id: firing.watcher_firing_id,
        error: message,
      });
    }

    this.eventBus.emit("watcher:fired", {
      watcherId: firing.watcher_id,
      planId,
      triggerType,
    });

    // If automation execution isn't enabled (default), mark the firing as handled.
    if (!this.isAutomationExecutionEnabled()) {
      await this.firingDal.markEnqueued({
        tenantId: firing.tenant_id,
        watcherFiringId: firing.watcher_firing_id,
        owner: this.owner,
      });
      return;
    }

    if (!this.engine || !this.policyService) {
      await this.firingDal.markFailed({
        tenantId: firing.tenant_id,
        watcherFiringId: firing.watcher_firing_id,
        owner: this.owner,
        error: "automation enabled but execution engine/policy service not configured",
      });
      return;
    }

    if (!cfg) {
      await this.firingDal.markFailed({
        tenantId: firing.tenant_id,
        watcherFiringId: firing.watcher_firing_id,
        owner: this.owner,
        error: "invalid periodic schedule config",
      });
      return;
    }

    const key = cfg.key ?? `cron:watcher-${String(firing.watcher_id)}`;
    if (cfg.laneRaw && !cfg.lane) {
      await this.firingDal.markFailed({
        tenantId: firing.tenant_id,
        watcherFiringId: firing.watcher_firing_id,
        owner: this.owner,
        error: `invalid periodic watcher lane '${cfg.laneRaw}'`,
      });
      return;
    }
    const lane = cfg.lane ?? "cron";
    const playbookId = cfg.execution.kind === "playbook" ? cfg.execution.playbook_id : planId;
    const scopeKeys = await this.db.get<{
      tenant_key: string;
      workspace_key: string;
      agent_key: string;
    }>(
      `SELECT t.tenant_key, ws.workspace_key, ag.agent_key
       FROM tenants t
       JOIN workspaces ws
         ON ws.tenant_id = t.tenant_id
       JOIN agents ag
         ON ag.tenant_id = ws.tenant_id
       WHERE t.tenant_id = ?
         AND ws.workspace_id = ?
         AND ag.agent_id = ?
      LIMIT 1`,
      [firing.tenant_id, watcher.workspace_id, watcher.agent_id],
    );
    if (!scopeKeys?.tenant_key || !scopeKeys.workspace_key || !scopeKeys.agent_key) {
      await this.firingDal.markFailed({
        tenantId: firing.tenant_id,
        watcherFiringId: firing.watcher_firing_id,
        owner: this.owner,
        error: "failed to resolve watcher scope keys",
      });
      return;
    }

    let steps: ActionPrimitive[] | undefined =
      cfg.execution.kind === "steps" ? cfg.execution.steps : undefined;
    let playbook: Playbook | undefined;

    if (!steps && cfg.execution.kind === "agent_turn") {
      steps = [
        {
          type: "Decide",
          args: this.buildAutomationTurnRequest({
            watcher,
            firing,
            config: cfg,
            tenantKey: scopeKeys.tenant_key,
            agentKey: scopeKeys.agent_key,
            workspaceKey: scopeKeys.workspace_key,
          }),
        },
      ];
    }

    if (!steps) {
      playbook = this.playbooksById.get(playbookId);
      if (!playbook) {
        await this.firingDal.markFailed({
          tenantId: firing.tenant_id,
          watcherFiringId: firing.watcher_firing_id,
          owner: this.owner,
          error: `playbook '${playbookId}' not found (set trigger_config.playbook_id or supply trigger_config.steps)`,
        });
        return;
      }
      if (!this.playbookRunner) {
        await this.firingDal.markFailed({
          tenantId: firing.tenant_id,
          watcherFiringId: firing.watcher_firing_id,
          owner: this.owner,
          error: "playbook runner not configured",
        });
        return;
      }
      steps = this.playbookRunner.run(playbook).steps;
    }

    const automationPlanId = `automation-${firing.watcher_firing_id}`;
    const requestId = `automation-${firing.watcher_firing_id}`;

    const playbookBundle = playbook ? this.resolvePlaybookBundle(playbook) : undefined;
    const effective = await this.policyService.loadEffectiveBundle({ playbookBundle });
    const snapshot = await this.policyService.getOrCreateSnapshot(
      firing.tenant_id,
      effective.bundle,
    );

    try {
      const result = await this.db.transaction(async (tx) => {
        // Ensure we still own this firing before enqueuing.
        const current = await tx.get<{ status: string; lease_owner: string | null }>(
          `SELECT status, lease_owner
           FROM watcher_firings
           WHERE tenant_id = ? AND watcher_firing_id = ?`,
          [firing.tenant_id, firing.watcher_firing_id],
        );
        if (!current || current.status !== "processing" || current.lease_owner !== this.owner) {
          return null;
        }

        const enqueued = await this.engine!.enqueuePlanInTx(tx, {
          tenantId: firing.tenant_id,
          key,
          lane,
          planId: automationPlanId,
          requestId,
          workspaceKey: scopeKeys.workspace_key,
          steps: steps!,
          policySnapshotId: snapshot.policy_snapshot_id,
          trigger: {
            kind: lane === "heartbeat" ? "heartbeat" : "cron",
            key,
            lane,
            metadata: {
              schedule_kind: cfg.schedule_kind,
              schedule_id: watcher.watcher_id,
              firing_id: firing.watcher_firing_id,
              watcher_id: firing.watcher_id,
              plan_id: planId,
              trigger_type: triggerType,
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
           WHERE tenant_id = ?
             AND watcher_firing_id = ?
             AND lease_owner = ?
             AND status = 'processing'`,
          [
            enqueued.jobId,
            enqueued.runId,
            new Date().toISOString(),
            firing.tenant_id,
            firing.watcher_firing_id,
            this.owner,
          ],
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
        firing_id: firing.watcher_firing_id,
        watcher_id: firing.watcher_id,
        job_id: result.jobId,
        run_id: result.runId,
      });
    } catch (err) {
      if (err instanceof LostFiringLeaseError) {
        // Another scheduler likely took over; we rolled back any partial writes.
        this.logger?.debug("watcher.firing_lost_lease", {
          firing_id: firing.watcher_firing_id,
          watcher_id: firing.watcher_id,
          error: err.message,
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      await this.firingDal.markFailed({
        tenantId: firing.tenant_id,
        watcherFiringId: firing.watcher_firing_id,
        owner: this.owner,
        error: message,
      });
      this.logger?.warn("watcher.firing_process_failed", {
        firing_id: firing.watcher_firing_id,
        watcher_id: firing.watcher_id,
        error: message,
      });
    }
  }
}
