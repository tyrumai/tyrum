import type { Emitter } from "mitt";
import type { GatewayEvents } from "../../event-bus.js";
import type { ActionPrimitive, Playbook } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import { sqlActiveWhereClause } from "../../statestore/sql.js";
import type { Logger } from "../observability/logger.js";
import type { ExecutionEngine } from "../execution/engine.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import {
  buildHeartbeatConversationKey,
  buildScheduleConversationKey,
} from "../automation/conversation-routing.js";
import type { PlaybookRunner } from "../playbook/runner.js";
import { queueScopedWorkflowRunFromActions } from "../workflow-run/queue-scoped-run.js";
import { WatcherFiringDal, type WatcherFiringRow } from "./firing-dal.js";
import { resolvePendingScheduleFireMs } from "../automation/schedule-service.js";
import {
  buildAutomationTurnRequest,
  getErrorMessage,
  getPlanId,
  parsePeriodicConfig,
  resolvePlaybookBundle,
  type RawPeriodicWatcherRow,
  type SchedulerPeriodicConfig,
  type WatcherScopeKeys,
} from "./scheduler-helpers.js";

const DEFAULT_TICK_MS = 60_000;
const DEFAULT_FIRING_LEASE_TTL_MS = 60_000;
const DEFAULT_PROCESS_BATCH = 25;

class LostFiringLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LostFiringLeaseError";
  }
}

export interface WatcherSchedulerOptions {
  db: SqlDb;
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
  automationEnabled?: boolean;
  keepProcessAlive?: boolean;
}
export class WatcherScheduler {
  private readonly db: SqlDb;
  private readonly eventBus: Emitter<GatewayEvents>;
  private readonly owner: string;
  private readonly logger?: Logger;
  private readonly tickMs: number;
  private readonly keepProcessAlive: boolean;
  private readonly automationEnabled: boolean;
  private readonly firingLeaseTtlMs: number;
  private readonly maxFiringsPerTick: number;
  private readonly firingDal: WatcherFiringDal;
  private readonly policyService?: PolicyService;
  private readonly playbookRunner?: PlaybookRunner;
  private readonly playbooksById: Map<string, Playbook>;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: WatcherSchedulerOptions) {
    this.db = opts.db;
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
    if (!this.keepProcessAlive) this.timer.unref();
  }
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
  async tick(): Promise<void> {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const activeWhere = sqlActiveWhereClause(this.db);
    const watchers = await this.getActivePeriodicWatchers();
    for (const watcher of watchers) {
      const config = parsePeriodicConfig(watcher.trigger_config_json);
      if (!config) continue;
      const slotMs = resolvePendingScheduleFireMs({
        config,
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
        await this.db.run(
          `UPDATE watchers
           SET last_fired_at_ms = ?, updated_at = ?
           WHERE tenant_id = ? AND watcher_id = ? AND trigger_type = 'periodic' AND ${activeWhere.sql}
             AND (last_fired_at_ms IS NULL OR last_fired_at_ms < ?)`,
          [slotMs, nowIso, watcher.tenant_id, watcher.watcher_id, ...activeWhere.params, slotMs],
        );

        if (created.created)
          this.logger?.info("watcher.firing_created", {
            watcher_id: watcher.watcher_id,
            schedule_kind: config.schedule_kind,
            firing_id: created.row.watcher_firing_id,
            scheduled_at_ms: slotMs,
          });
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
  private async markFiringFailed(firing: WatcherFiringRow, error: string): Promise<void> {
    await this.firingDal.markFailed({
      tenantId: firing.tenant_id,
      watcherFiringId: firing.watcher_firing_id,
      owner: this.owner,
      error,
    });
  }
  private async markFiringEnqueued(firing: WatcherFiringRow): Promise<void> {
    await this.firingDal.markEnqueued({
      tenantId: firing.tenant_id,
      watcherFiringId: firing.watcher_firing_id,
      owner: this.owner,
    });
  }
  private async getScopeKeys(
    firing: WatcherFiringRow,
    watcher: RawPeriodicWatcherRow,
  ): Promise<WatcherScopeKeys | undefined> {
    return await this.db.get<WatcherScopeKeys>(
      `SELECT t.tenant_key, ws.workspace_key, ag.agent_key
       FROM tenants t
       JOIN workspaces ws ON ws.tenant_id = t.tenant_id
       JOIN agents ag ON ag.tenant_id = ws.tenant_id
       WHERE t.tenant_id = ? AND ws.workspace_id = ? AND ag.agent_id = ?
       LIMIT 1`,
      [firing.tenant_id, watcher.workspace_id, watcher.agent_id],
    );
  }
  private async resolveExecution(input: {
    firing: WatcherFiringRow;
    watcher: RawPeriodicWatcherRow;
    cfg: SchedulerPeriodicConfig;
    key: string;
    scopeKeys: WatcherScopeKeys;
  }): Promise<{ steps: ActionPrimitive[]; playbook?: Playbook } | undefined> {
    const { firing, watcher, cfg, key, scopeKeys } = input;
    if (cfg.execution.kind === "steps") return { steps: cfg.execution.steps };
    if (cfg.execution.kind === "agent_turn") {
      return {
        steps: [
          {
            type: "Decide",
            args: buildAutomationTurnRequest({
              watcher,
              firing,
              config: cfg,
              key,
              tenantKey: scopeKeys.tenant_key,
              agentKey: scopeKeys.agent_key,
              workspaceKey: scopeKeys.workspace_key,
            }),
          },
        ],
      };
    }
    const playbook = this.playbooksById.get(cfg.execution.playbook_id);
    if (!playbook) {
      await this.markFiringFailed(
        firing,
        `playbook '${cfg.execution.playbook_id}' not found (set trigger_config.playbook_id or supply trigger_config.steps)`,
      );
      return;
    }
    if (!this.playbookRunner) {
      await this.markFiringFailed(firing, "playbook runner not configured");
      return;
    }
    return { playbook, steps: this.playbookRunner.run(playbook).steps };
  }
  private async enqueueAutomationPlan(input: {
    firing: WatcherFiringRow;
    watcher: RawPeriodicWatcherRow;
    cfg: SchedulerPeriodicConfig;
    triggerType: string;
    key: string;
    planId: string;
    steps: ActionPrimitive[];
    playbook?: Playbook;
  }): Promise<void> {
    const { firing, watcher, cfg, triggerType, key, planId, steps, playbook } = input;
    const automationPlanId = `automation-${firing.watcher_firing_id}`;
    const playbookBundle = playbook ? resolvePlaybookBundle(playbook) : undefined;
    try {
      const result = await this.db.transaction(async (tx) => {
        const current = await tx.get<{ status: string; lease_owner: string | null }>(
          `SELECT status, lease_owner FROM watcher_firings WHERE tenant_id = ? AND watcher_firing_id = ?`,
          [firing.tenant_id, firing.watcher_firing_id],
        );
        if (!current || current.status !== "processing" || current.lease_owner !== this.owner)
          return null;
        const workflowRunId = await queueScopedWorkflowRunFromActions({
          db: tx,
          transactionMode: "reuse",
          tenantId: firing.tenant_id,
          agentId: watcher.agent_id,
          workspaceId: watcher.workspace_id,
          runKey: key,
          conversationKey: key,
          planId: automationPlanId,
          requestId: automationPlanId,
          trigger: {
            kind: cfg.schedule_kind === "heartbeat" ? "heartbeat" : "cron",
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
          policyService: this.policyService!,
          playbookBundle,
          actions: steps,
        });
        const updated = await tx.run(
          `UPDATE watcher_firings
           SET status = 'enqueued',
               lease_owner = NULL,
               lease_expires_at_ms = NULL,
               workflow_run_id = ?,
               job_id = NULL,
               turn_id = NULL,
               error = NULL,
               updated_at = ?
           WHERE tenant_id = ? AND watcher_firing_id = ? AND lease_owner = ? AND status = 'processing'`,
          [
            workflowRunId,
            new Date().toISOString(),
            firing.tenant_id,
            firing.watcher_firing_id,
            this.owner,
          ],
        );
        if (updated.changes !== 1)
          throw new LostFiringLeaseError("lost watcher firing lease while enqueuing");
        return { workflowRunId };
      });
      if (!result) return;
      this.logger?.info("watcher.firing_enqueued", {
        firing_id: firing.watcher_firing_id,
        watcher_id: firing.watcher_id,
        workflow_run_id: result.workflowRunId,
      });
    } catch (err) {
      if (err instanceof LostFiringLeaseError) {
        this.logger?.debug("watcher.firing_lost_lease", {
          firing_id: firing.watcher_firing_id,
          watcher_id: firing.watcher_id,
          error: err.message,
        });
        return;
      }
      const message = getErrorMessage(err);
      await this.markFiringFailed(firing, message);
      this.logger?.warn("watcher.firing_process_failed", {
        firing_id: firing.watcher_firing_id,
        watcher_id: firing.watcher_id,
        error: message,
      });
    }
  }
  private async findActiveRunForKey(input: {
    tenantId: string;
    key: string;
  }): Promise<{ workflowRunId: string | null; turnId: string | null } | undefined> {
    const workflowRun = await this.db.get<{ workflow_run_id: string }>(
      `SELECT workflow_run_id
       FROM workflow_runs
       WHERE tenant_id = ?
         AND run_key = ?
         AND status IN ('queued', 'running', 'paused')
       ORDER BY created_at DESC
       LIMIT 1`,
      [input.tenantId, input.key],
    );
    if (workflowRun?.workflow_run_id) {
      const turn = await this.db.get<{ turn_id: string }>(
        `SELECT turn_id
         FROM turns
         WHERE tenant_id = ?
           AND turn_id = ?
         LIMIT 1`,
        [input.tenantId, workflowRun.workflow_run_id],
      );
      return {
        workflowRunId: workflowRun.workflow_run_id,
        turnId: turn?.turn_id ?? null,
      };
    }

    const row = await this.db.get<{ turn_id: string }>(
      `SELECT turn_id AS turn_id
       FROM turns
       WHERE tenant_id = ?
         AND conversation_key = ?
         AND status IN ('queued', 'running', 'paused')
       ORDER BY created_at DESC
       LIMIT 1`,
      [input.tenantId, input.key],
    );
    if (!row?.turn_id) return undefined;
    return {
      workflowRunId: null,
      turnId: row.turn_id,
    };
  }
  private async processFiring(firing: WatcherFiringRow): Promise<void> {
    const watcher = await this.db.get<RawPeriodicWatcherRow>(
      `SELECT * FROM watchers WHERE tenant_id = ? AND watcher_id = ? LIMIT 1`,
      [firing.tenant_id, firing.watcher_id],
    );
    if (!watcher) return this.markFiringFailed(firing, "watcher not found");

    const triggerType = watcher.trigger_type;
    const cfg = parsePeriodicConfig(watcher.trigger_config_json);
    if (triggerType === "webhook") {
      return !this.automationEnabled
        ? this.markFiringEnqueued(firing)
        : this.markFiringFailed(firing, "webhook-triggered automation execution is not configured");
    }
    if (triggerType !== "periodic") {
      return this.markFiringFailed(firing, `unexpected watcher trigger type '${triggerType}'`);
    }
    if (!cfg) return this.markFiringFailed(firing, "invalid periodic schedule config");

    const planId = getPlanId(cfg);
    this.eventBus.emit("watcher:fired", { watcherId: firing.watcher_id, planId, triggerType });
    if (!this.automationEnabled) return this.markFiringEnqueued(firing);
    if (!this.policyService) {
      return this.markFiringFailed(firing, "automation enabled but policy service not configured");
    }

    const scopeKeys = await this.getScopeKeys(firing, watcher);
    if (!scopeKeys?.tenant_key || !scopeKeys.workspace_key || !scopeKeys.agent_key) {
      return this.markFiringFailed(firing, "failed to resolve watcher scope keys");
    }
    const key =
      cfg.key ??
      (cfg.schedule_kind === "heartbeat"
        ? buildHeartbeatConversationKey({
            agentKey: scopeKeys.agent_key,
            workspaceKey: scopeKeys.workspace_key,
          })
        : buildScheduleConversationKey({
            agentKey: scopeKeys.agent_key,
            workspaceKey: scopeKeys.workspace_key,
            scheduleId: watcher.watcher_id,
          }));
    let resolved: Awaited<ReturnType<WatcherScheduler["resolveExecution"]>>;
    try {
      resolved = await this.resolveExecution({ firing, watcher, cfg, key, scopeKeys });
    } catch (err) {
      const message = getErrorMessage(err);
      await this.markFiringFailed(firing, message);
      this.logger?.warn("watcher.firing_process_failed", {
        firing_id: firing.watcher_firing_id,
        watcher_id: firing.watcher_id,
        error: message,
      });
      return;
    }
    if (!resolved) return;

    if (cfg.schedule_kind === "heartbeat") {
      const activeRun = await this.findActiveRunForKey({
        tenantId: firing.tenant_id,
        key,
      });
      if (activeRun) {
        await this.firingDal.markEnqueued({
          tenantId: firing.tenant_id,
          watcherFiringId: firing.watcher_firing_id,
          owner: this.owner,
          workflowRunId: activeRun.workflowRunId,
          turnId: activeRun.turnId,
        });
        this.logger?.info("watcher.firing_suppressed_active_heartbeat", {
          firing_id: firing.watcher_firing_id,
          watcher_id: firing.watcher_id,
          workflow_run_id: activeRun.workflowRunId,
          turn_id: activeRun.turnId,
          key,
        });
        return;
      }
    }

    await this.enqueueAutomationPlan({
      firing,
      watcher,
      cfg,
      triggerType,
      key,
      planId,
      steps: resolved.steps,
      playbook: resolved.playbook,
    });
  }
}
