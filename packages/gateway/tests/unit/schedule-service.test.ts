import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
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
    vi.useRealTimers();
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

  it("starts cron schedules from the current time and resets the cursor on resume", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T10:02:30.000Z"));

    const schedule = await service.createSchedule({
      tenantId: DEFAULT_TENANT_ID,
      kind: "cron",
      cadence: { type: "cron", expression: "0 12 * * *", timezone: "Europe/Amsterdam" },
      execution: {
        kind: "playbook",
        playbook_id: "daily-check",
      },
    });

    expect(schedule.last_fired_at).toBe("2026-03-06T10:02:30.000Z");
    expect(schedule.next_fire_at).toBe("2026-03-06T11:00:00.000Z");

    await service.pauseSchedule({
      tenantId: DEFAULT_TENANT_ID,
      scheduleId: schedule.schedule_id,
    });

    vi.setSystemTime(new Date("2026-03-06T10:50:00.000Z"));

    const resumed = await service.resumeSchedule({
      tenantId: DEFAULT_TENANT_ID,
      scheduleId: schedule.schedule_id,
    });

    expect(resumed.last_fired_at).toBe("2026-03-06T10:50:00.000Z");
    expect(resumed.next_fire_at).toBe("2026-03-06T11:00:00.000Z");
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

  it("rejects invalid steps schedules before persisting them", async () => {
    await expect(
      service.createSchedule({
        tenantId: DEFAULT_TENANT_ID,
        kind: "cron",
        cadence: { type: "interval", interval_ms: 60_000 },
        execution: {
          kind: "steps",
          steps: [{ type: "Nope", args: {} }] as never,
        },
      }),
    ).rejects.toThrow(/invalid steps schedule action/i);

    const afterFailedCreate = await db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM watchers WHERE tenant_id = ? AND trigger_type = 'periodic'",
      [DEFAULT_TENANT_ID],
    );
    expect(afterFailedCreate?.count).toBe(0);

    const valid = await service.createSchedule({
      tenantId: DEFAULT_TENANT_ID,
      kind: "cron",
      cadence: { type: "interval", interval_ms: 60_000 },
      execution: {
        kind: "steps",
        steps: [{ type: "CLI", args: { command: "echo hi" } }],
      },
    });

    await expect(
      service.updateSchedule({
        tenantId: DEFAULT_TENANT_ID,
        scheduleId: valid.schedule_id,
        patch: {
          execution: {
            kind: "steps",
            steps: [{ type: "Nope", args: {} }] as never,
          },
        },
      }),
    ).rejects.toThrow(/invalid steps schedule action/i);

    const reloaded = await service.getSchedule({
      tenantId: DEFAULT_TENANT_ID,
      scheduleId: valid.schedule_id,
      includeDeleted: true,
    });
    expect(reloaded?.execution).toEqual(valid.execution);
  });
});
