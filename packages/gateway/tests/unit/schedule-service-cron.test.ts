import { describe, expect, it } from "vitest";
import {
  ensureValidTimeZone,
  nextCronFireAtMs,
  parseCronExpression,
  resolveNextScheduleFireMs,
  resolvePendingScheduleFireMs,
} from "../../src/modules/automation/schedule-service-cron.js";
import type { NormalizedScheduleConfig } from "../../src/modules/automation/schedule-service-types.js";

function cronConfig(expression: string, timezone: string): NormalizedScheduleConfig {
  return {
    v: 1,
    schedule_kind: "cron",
    enabled: true,
    cadence: { type: "cron", expression, timezone },
    execution: { kind: "agent_turn" },
    delivery: { mode: "notify" },
    lane: "cron",
  };
}

describe("schedule-service-cron", () => {
  it("keeps five-field validation for cron expressions", () => {
    expect(() => parseCronExpression("0 12 * *")).toThrow(
      "cron expressions must have 5 fields: minute hour day month weekday",
    );
  });

  it("resolves the next fire time with timezone-aware cron-parser iteration", () => {
    const next = nextCronFireAtMs({
      expression: "5 11 * * *",
      timeZone: "Europe/Amsterdam",
      afterMs: Date.parse("2026-03-06T10:02:00.000Z"),
    });

    expect(new Date(next ?? 0).toISOString()).toBe("2026-03-06T10:05:00.000Z");
  });

  it("preserves OR semantics when both day-of-month and day-of-week are restricted", () => {
    const next = nextCronFireAtMs({
      expression: "0 9 15 * 1",
      timeZone: "UTC",
      afterMs: Date.parse("2026-07-13T10:00:00.000Z"),
    });

    expect(new Date(next ?? 0).toISOString()).toBe("2026-07-15T09:00:00.000Z");
  });

  it("validates timezones through the existing helper", () => {
    expect(() => ensureValidTimeZone("Mars/Olympus_Mons")).toThrow(/invalid timezone/i);
  });

  it("keeps pending and next-fire scheduling behavior for cron schedules", () => {
    const config = cronConfig("0 12 * * *", "Europe/Amsterdam");
    const lastFiredAtMs = Date.parse("2026-03-06T10:02:30.000Z");
    const nowMs = Date.parse("2026-03-06T11:00:00.000Z");

    expect(
      resolvePendingScheduleFireMs({
        config,
        lastFiredAtMs,
        nowMs,
      }),
    ).toBe(Date.parse("2026-03-06T11:00:00.000Z"));

    expect(
      resolveNextScheduleFireMs({
        config,
        lastFiredAtMs,
        nowMs,
      }),
    ).toBe(Date.parse("2026-03-06T11:00:00.000Z"));
  });
});
