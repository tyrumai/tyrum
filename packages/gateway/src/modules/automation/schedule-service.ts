import { randomUUID } from "node:crypto";
import { AgentKey, WorkspaceKey } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { sqlActiveWhereClause, sqlBoolParam } from "../../statestore/sql.js";
import type { IdentityScopeDal } from "../identity/scope.js";
import {
  defaultHeartbeatCadence,
  defaultStoredLastFiredAtMs,
  normalizeScheduleConfig,
  rowToScheduleRecord,
  serializeScheduleConfig,
} from "./schedule-service-helpers.js";
import { DEFAULT_HEARTBEAT_INSTRUCTION } from "./schedule-service-helpers.js";
import type {
  CreateScheduleInput,
  RawScheduleRow,
  ScheduleRecord,
  UpdateScheduleInput,
} from "./schedule-service-types.js";

export type {
  CreateScheduleInput,
  NormalizedScheduleConfig,
  RawScheduleRow,
  ScheduleCadence,
  ScheduleDeliveryMode,
  ScheduleExecution,
  ScheduleKind,
  ScheduleRecord,
  StoredScheduleConfig,
  UpdateScheduleInput,
} from "./schedule-service-types.js";

export {
  defaultHeartbeatCadence,
  defaultHeartbeatInstruction,
  formatIso,
  nextCronFireAtMs,
  normalizeScheduleConfig,
  parseScheduleConfig,
  resolveNextScheduleFireMs,
  resolvePendingScheduleFireMs,
  serializeScheduleConfig,
} from "./schedule-service-helpers.js";

function buildDefaultHeartbeatWatcherKey(input: { agentId: string; workspaceId: string }): string {
  return `schedule:default-heartbeat:${input.agentId}:${input.workspaceId}`;
}

export class ScheduleService {
  constructor(
    private readonly db: SqlDb,
    private readonly identityScopeDal: IdentityScopeDal,
  ) {}

  private async insertDefaultHeartbeatScheduleForMembership(input: {
    tenantId: string;
    agentId: string;
    workspaceId: string;
    nowMs: number;
  }): Promise<boolean> {
    const cadence = defaultHeartbeatCadence();
    const intervalMs =
      cadence.type === "interval" ? cadence.interval_ms : 30 * 60_000;
    const lastFiredAtMs = Math.floor(input.nowMs / intervalMs) * intervalMs;
    const watcherKey = buildDefaultHeartbeatWatcherKey({
      agentId: input.agentId,
      workspaceId: input.workspaceId,
    });
    const scheduleId = randomUUID();
    const config = normalizeScheduleConfig({
      kind: "heartbeat",
      cadence,
      execution: {
        kind: "agent_turn",
        instruction: DEFAULT_HEARTBEAT_INSTRUCTION,
      },
      delivery: { mode: "quiet" },
      seededDefault: true,
    });
    const nowIso = new Date(input.nowMs).toISOString();
    const inserted = await this.db.run(
      `INSERT INTO watchers (
         tenant_id,
         watcher_id,
         watcher_key,
         agent_id,
         workspace_id,
         trigger_type,
         trigger_config_json,
         active,
         last_fired_at_ms,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, 'periodic', ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, watcher_key) DO NOTHING`,
      [
        input.tenantId,
        scheduleId,
        watcherKey,
        input.agentId,
        input.workspaceId,
        serializeScheduleConfig(config),
        sqlBoolParam(this.db, true),
        lastFiredAtMs,
        nowIso,
        nowIso,
      ],
    );
    return inserted.changes > 0;
  }

  async listSchedules(input?: {
    tenantId: string;
    agentKey?: string;
    workspaceKey?: string;
    includeDeleted?: boolean;
  }): Promise<ScheduleRecord[]> {
    const tenantId = input?.tenantId?.trim();
    if (!tenantId) {
      throw new Error("tenantId is required");
    }
    const where = ["w.tenant_id = ?", "w.trigger_type = 'periodic'"];
    const params: unknown[] = [tenantId];
    if (input?.agentKey?.trim()) {
      where.push("ag.agent_key = ?");
      params.push(input.agentKey.trim());
    }
    if (input?.workspaceKey?.trim()) {
      where.push("ws.workspace_key = ?");
      params.push(input.workspaceKey.trim());
    }
    if (!input?.includeDeleted) {
      const activeWhere = sqlActiveWhereClause(this.db, { column: "w.active" });
      params.push(...activeWhere.params);
      where.push(activeWhere.sql);
    }

    const rows = await this.db.all<RawScheduleRow>(
      `SELECT
         w.*,
         ag.agent_key,
         ws.workspace_key
       FROM watchers w
       JOIN agents ag
         ON ag.tenant_id = w.tenant_id
        AND ag.agent_id = w.agent_id
       JOIN workspaces ws
         ON ws.tenant_id = w.tenant_id
        AND ws.workspace_id = w.workspace_id
       WHERE ${where.join(" AND ")}
       ORDER BY w.created_at DESC`,
      params,
    );

    const nowMs = Date.now();
    return rows
      .map((row) => rowToScheduleRecord(row, nowMs))
      .filter((row): row is ScheduleRecord => Boolean(row));
  }

  async getSchedule(input: {
    tenantId: string;
    scheduleId: string;
    includeDeleted?: boolean;
  }): Promise<ScheduleRecord | undefined> {
    const tenantId = input.tenantId.trim();
    const scheduleId = input.scheduleId.trim();
    const where = ["w.tenant_id = ?", "w.watcher_id = ?", "w.trigger_type = 'periodic'"];
    const params: unknown[] = [tenantId, scheduleId];
    if (!input.includeDeleted) {
      const activeWhere = sqlActiveWhereClause(this.db, { column: "w.active" });
      params.push(...activeWhere.params);
      where.push(activeWhere.sql);
    }

    const row = await this.db.get<RawScheduleRow>(
      `SELECT
         w.*,
         ag.agent_key,
         ws.workspace_key
       FROM watchers w
       JOIN agents ag
         ON ag.tenant_id = w.tenant_id
        AND ag.agent_id = w.agent_id
       JOIN workspaces ws
         ON ws.tenant_id = w.tenant_id
        AND ws.workspace_id = w.workspace_id
       WHERE ${where.join(" AND ")}
       LIMIT 1`,
      params,
    );

    return row ? rowToScheduleRecord(row, Date.now()) : undefined;
  }

  async createSchedule(input: CreateScheduleInput): Promise<ScheduleRecord> {
    const tenantId = input.tenantId.trim();
    const agentKey = input.agentKey?.trim() || "default";
    const workspaceKey = input.workspaceKey?.trim() || "default";
    AgentKey.parse(agentKey);
    WorkspaceKey.parse(workspaceKey);

    const agentId = await this.identityScopeDal.ensureAgentId(tenantId, agentKey);
    const workspaceId = await this.identityScopeDal.ensureWorkspaceId(tenantId, workspaceKey);
    await this.identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);

    const scheduleId = randomUUID();
    const watcherKey = input.watcherKey?.trim() || `schedule:${scheduleId}`;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const config = normalizeScheduleConfig({
      kind: input.kind,
      enabled: input.enabled,
      cadence: input.cadence,
      execution: input.execution,
      delivery: input.delivery,
      seededDefault: input.seededDefault,
    });

    await this.db.run(
      `INSERT INTO watchers (
         tenant_id,
         watcher_id,
         watcher_key,
         agent_id,
         workspace_id,
         trigger_type,
         trigger_config_json,
         active,
         last_fired_at_ms,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, 'periodic', ?, ?, ?, ?, ?)`,
      [
        tenantId,
        scheduleId,
        watcherKey,
        agentId,
        workspaceId,
        serializeScheduleConfig(config),
        sqlBoolParam(this.db, true),
        input.lastFiredAtMs !== undefined
          ? input.lastFiredAtMs
          : defaultStoredLastFiredAtMs(config, nowMs),
        nowIso,
        nowIso,
      ],
    );

    const created = await this.getSchedule({ tenantId, scheduleId });
    if (!created) {
      throw new Error("failed to create schedule");
    }
    return created;
  }

  async updateSchedule(input: {
    tenantId: string;
    scheduleId: string;
    patch: UpdateScheduleInput;
  }): Promise<ScheduleRecord> {
    const existingRow = await this.db.get<{ last_fired_at_ms: number | null }>(
      `SELECT last_fired_at_ms
       FROM watchers
       WHERE tenant_id = ? AND watcher_id = ? AND trigger_type = 'periodic'
       LIMIT 1`,
      [input.tenantId, input.scheduleId],
    );
    const existing = await this.getSchedule({
      tenantId: input.tenantId,
      scheduleId: input.scheduleId,
      includeDeleted: true,
    });
    if (!existing) {
      throw new Error("schedule not found");
    }

    const config = normalizeScheduleConfig({
      kind: input.patch.kind ?? existing.kind,
      enabled: input.patch.enabled ?? existing.enabled,
      cadence: input.patch.cadence ?? existing.cadence,
      execution: input.patch.execution ?? existing.execution,
      delivery: {
        mode: input.patch.delivery?.mode ?? existing.delivery.mode,
      },
      seededDefault: existing.seeded_default,
    });
    const nowMs = Date.now();
    const resetLastFiredAtMs =
      config.enabled &&
      config.cadence.type === "cron" &&
      (!existing.enabled ||
        existing.cadence.type !== "cron" ||
        existingRow?.last_fired_at_ms === null ||
        existingRow?.last_fired_at_ms === undefined);
    const nextLastFiredAtMs = resetLastFiredAtMs ? nowMs : (existingRow?.last_fired_at_ms ?? null);

    await this.db.run(
      `UPDATE watchers
       SET trigger_config_json = ?, last_fired_at_ms = ?, updated_at = ?
       WHERE tenant_id = ? AND watcher_id = ? AND trigger_type = 'periodic'`,
      [
        serializeScheduleConfig(config),
        nextLastFiredAtMs,
        new Date(nowMs).toISOString(),
        input.tenantId,
        input.scheduleId,
      ],
    );

    const updated = await this.getSchedule({
      tenantId: input.tenantId,
      scheduleId: input.scheduleId,
      includeDeleted: true,
    });
    if (!updated) {
      throw new Error("failed to update schedule");
    }
    return updated;
  }

  async pauseSchedule(input: { tenantId: string; scheduleId: string }): Promise<ScheduleRecord> {
    return await this.updateSchedule({
      tenantId: input.tenantId,
      scheduleId: input.scheduleId,
      patch: { enabled: false },
    });
  }

  async resumeSchedule(input: { tenantId: string; scheduleId: string }): Promise<ScheduleRecord> {
    return await this.updateSchedule({
      tenantId: input.tenantId,
      scheduleId: input.scheduleId,
      patch: { enabled: true },
    });
  }

  async deleteSchedule(input: { tenantId: string; scheduleId: string }): Promise<void> {
    const existing = await this.db.get<{ watcher_id: string }>(
      `SELECT watcher_id
       FROM watchers
       WHERE tenant_id = ? AND watcher_id = ? AND trigger_type = 'periodic'
       LIMIT 1`,
      [input.tenantId, input.scheduleId],
    );
    if (!existing) {
      throw new Error("schedule not found");
    }

    await this.db.run(
      `UPDATE watchers
       SET active = ?, updated_at = ?
       WHERE tenant_id = ? AND watcher_id = ? AND trigger_type = 'periodic'`,
      [sqlBoolParam(this.db, false), new Date().toISOString(), input.tenantId, input.scheduleId],
    );
  }

  async ensureDefaultHeartbeatScheduleForMembership(input: {
    tenantId: string;
    agentId: string;
    workspaceId: string;
    nowMs?: number;
  }): Promise<boolean> {
    return await this.insertDefaultHeartbeatScheduleForMembership({
      ...input,
      nowMs: input.nowMs ?? Date.now(),
    });
  }

  async seedDefaultHeartbeatSchedules(nowMs = Date.now()): Promise<number> {
    const memberships = await this.db.all<{
      tenant_id: string;
      agent_id: string;
      workspace_id: string;
    }>(
      `SELECT tenant_id, agent_id, workspace_id
       FROM agent_workspaces
       ORDER BY tenant_id, agent_id, workspace_id`,
    );
    if (memberships.length === 0) return 0;

    let created = 0;

    for (const membership of memberships) {
      if (
        await this.insertDefaultHeartbeatScheduleForMembership({
          tenantId: membership.tenant_id,
          agentId: membership.agent_id,
          workspaceId: membership.workspace_id,
          nowMs,
        })
      ) {
        created += 1;
      }
    }

    return created;
  }
}
