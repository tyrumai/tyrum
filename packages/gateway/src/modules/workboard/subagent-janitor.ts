import { IntervalScheduler, resolvePositiveInt } from "../lifecycle/scheduler.js";
import type { Logger } from "../observability/logger.js";
import type { SqlDb } from "../../statestore/types.js";
import type { SessionLaneNodeAttachmentDal } from "../agent/session-lane-node-attachment-dal.js";
import { WorkboardDal } from "./dal.js";
import { cleanupManagedDesktop } from "./orchestration-support.js";

const DEFAULT_TICK_MS = 5_000;
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1_000;

export class SubagentJanitor {
  private readonly workboard: WorkboardDal;
  private readonly scheduler: IntervalScheduler;

  constructor(
    private readonly opts: {
      db: SqlDb;
      sessionLaneNodeAttachmentDal: SessionLaneNodeAttachmentDal;
      logger?: Logger;
      tickMs?: number;
      retentionMs?: number;
      keepProcessAlive?: boolean;
    },
  ) {
    this.workboard = new WorkboardDal(opts.db);
    this.scheduler = new IntervalScheduler({
      tickMs: resolvePositiveInt(opts.tickMs, DEFAULT_TICK_MS),
      keepProcessAlive: opts.keepProcessAlive ?? false,
      onTickError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.opts.logger?.error("workboard.subagent_janitor_tick_failed", { error: message });
      },
      tick: async () => {
        await this.tickOnce();
      },
    });
  }

  start(): void {
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
  }

  async tick(): Promise<void> {
    await this.scheduler.tick();
  }

  private async tickOnce(): Promise<void> {
    const subagents = await this.opts.db.all<{
      tenant_id: string;
      agent_id: string;
      workspace_id: string;
      subagent_id: string;
      session_key: string;
      lane: string;
      desktop_environment_id: string | null;
      work_item_id: string | null;
      execution_profile: string;
      status: string;
      work_item_status: string | null;
    }>(
      `SELECT s.tenant_id, s.agent_id, s.workspace_id, s.subagent_id, s.session_key, s.lane,
              s.desktop_environment_id, s.work_item_id, s.execution_profile, s.status,
              i.status AS work_item_status
       FROM subagents s
       LEFT JOIN work_items i ON i.tenant_id = s.tenant_id AND i.work_item_id = s.work_item_id
       WHERE s.status IN ('closed', 'failed')
          OR (
            s.execution_profile = 'planner'
            AND s.status IN ('running', 'paused')
            AND (i.status IS NULL OR i.status <> 'backlog')
          )
       LIMIT 100`,
    );

    for (const subagent of subagents) {
      const scope = {
        tenant_id: subagent.tenant_id,
        agent_id: subagent.agent_id,
        workspace_id: subagent.workspace_id,
      };
      if (
        subagent.execution_profile === "planner" &&
        (subagent.status === "running" || subagent.status === "paused") &&
        subagent.work_item_status !== "backlog"
      ) {
        await this.workboard
          .markSubagentClosed({
            scope,
            subagent_id: subagent.subagent_id,
          })
          .catch(() => undefined);
      }

      if (subagent.desktop_environment_id) {
        try {
          await cleanupManagedDesktop({
            db: this.opts.db,
            tenantId: subagent.tenant_id,
            environmentId: subagent.desktop_environment_id,
          });
          await this.workboard.updateSubagent({
            scope,
            subagent_id: subagent.subagent_id,
            patch: {
              desktop_environment_id: null,
              attached_node_id: null,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.opts.logger?.warn("workboard.subagent_janitor_cleanup_failed", {
            subagent_id: subagent.subagent_id,
            environment_id: subagent.desktop_environment_id,
            error: message,
          });
        }
      }

      await this.opts.sessionLaneNodeAttachmentDal.delete({
        tenantId: subagent.tenant_id,
        key: subagent.session_key,
        lane: subagent.lane,
      });
    }

    const cutoffIso = new Date(
      Date.now() - Math.max(60_000, this.opts.retentionMs ?? DEFAULT_RETENTION_MS),
    ).toISOString();
    const scopes = await this.opts.db.all<{
      tenant_id: string;
      agent_id: string;
      workspace_id: string;
    }>(
      `SELECT DISTINCT tenant_id, agent_id, workspace_id
       FROM subagents
       WHERE status IN ('closed', 'failed')
         AND closed_at IS NOT NULL
         AND closed_at <= ?
       LIMIT 100`,
      [cutoffIso],
    );
    for (const scope of scopes) {
      await this.workboard.deleteTerminatedSubagentsBefore({
        scope,
        closedBeforeIso: cutoffIso,
      });
    }
  }
}
