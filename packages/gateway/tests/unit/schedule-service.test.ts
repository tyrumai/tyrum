import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import {
  ScheduleService,
  nextCronFireAtMs,
} from "../../src/modules/automation/schedule-service.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

describe("ScheduleService", () => {
  let db: SqliteDb;
  let service: ScheduleService;
  let identityScopeDal: IdentityScopeDal;

  beforeEach(() => {
    db = openTestSqliteDb();
    identityScopeDal = new IdentityScopeDal(db);
    service = new ScheduleService(db, identityScopeDal);
  });

  afterEach(async () => {
    await db.close();
  });

  it("creates, pauses, resumes, and deletes schedules", async () => {
    const schedule = await service.createSchedule({
      tenantId: DEFAULT_TENANT_ID,
      kind: "heartbeat",
      cadence: { type: "interval", interval_ms: 30 * 60_000 },
      execution: {
        kind: "agent_turn",
        instruction: "Check workboard state.",
      },
      delivery: { mode: "quiet" },
    });

    expect(schedule.kind).toBe("heartbeat");
    expect(schedule.enabled).toBe(true);
    expect(schedule.delivery.mode).toBe("quiet");

    const paused = await service.pauseSchedule({
      tenantId: DEFAULT_TENANT_ID,
      scheduleId: schedule.schedule_id,
    });
    expect(paused.enabled).toBe(false);

    const resumed = await service.resumeSchedule({
      tenantId: DEFAULT_TENANT_ID,
      scheduleId: schedule.schedule_id,
    });
    expect(resumed.enabled).toBe(true);

    await service.deleteSchedule({
      tenantId: DEFAULT_TENANT_ID,
      scheduleId: schedule.schedule_id,
    });

    const deleted = await service.getSchedule({
      tenantId: DEFAULT_TENANT_ID,
      scheduleId: schedule.schedule_id,
      includeDeleted: true,
    });
    expect(deleted?.deleted).toBe(true);
  });

  it("seeds one default heartbeat per membership and does not recreate deleted defaults", async () => {
    const createdCount = await service.seedDefaultHeartbeatSchedules(
      Date.UTC(2026, 2, 6, 10, 0, 0),
    );
    expect(createdCount).toBeGreaterThanOrEqual(1);

    const schedules = await service.listSchedules({
      tenantId: DEFAULT_TENANT_ID,
      includeDeleted: true,
    });
    const defaultHeartbeat = schedules.find((schedule) => schedule.seeded_default);
    expect(defaultHeartbeat).toBeDefined();
    expect(defaultHeartbeat?.kind).toBe("heartbeat");
    expect(defaultHeartbeat?.enabled).toBe(true);

    await service.deleteSchedule({
      tenantId: DEFAULT_TENANT_ID,
      scheduleId: defaultHeartbeat!.schedule_id,
    });

    const reseededCount = await service.seedDefaultHeartbeatSchedules(
      Date.UTC(2026, 2, 6, 10, 30, 0),
    );
    expect(reseededCount).toBe(0);

    const afterDelete = await service.listSchedules({
      tenantId: DEFAULT_TENANT_ID,
      includeDeleted: true,
    });
    const matching = afterDelete.filter(
      (schedule) => schedule.schedule_id === defaultHeartbeat!.schedule_id,
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]!.deleted).toBe(true);
  });

  it("computes the next matching cron fire in a timezone-aware way", () => {
    const afterMs = Date.parse("2026-03-06T10:02:00.000Z");
    const next = nextCronFireAtMs({
      expression: "5 11 * * *",
      timeZone: "Europe/Amsterdam",
      afterMs,
    });

    expect(next).toBeDefined();
    expect(new Date(next!).toISOString()).toBe("2026-03-06T10:05:00.000Z");
  });

  it("ensures the default heartbeat for a membership without creating duplicates", async () => {
    const first = await service.ensureDefaultHeartbeatScheduleForMembership({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      nowMs: Date.UTC(2026, 2, 6, 10, 0, 0),
    });
    const second = await service.ensureDefaultHeartbeatScheduleForMembership({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      nowMs: Date.UTC(2026, 2, 6, 10, 5, 0),
    });

    expect(first).toBe(true);
    expect(second).toBe(false);

    const schedules = await service.listSchedules({
      tenantId: DEFAULT_TENANT_ID,
      includeDeleted: true,
    });
    const matching = schedules.filter(
      (schedule) =>
        schedule.seeded_default &&
        schedule.target_scope.agent_key === "default" &&
        schedule.target_scope.workspace_key === "default",
    );
    expect(matching).toHaveLength(1);
  });
});
