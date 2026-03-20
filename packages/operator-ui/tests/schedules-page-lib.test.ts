import { describe, expect, it } from "vitest";
import {
  cadenceUnitToMs,
  describeExecution,
  formatAbsoluteTime,
  formatCadence,
  formatInterval,
  sortSchedules,
} from "../src/components/pages/schedules-page.lib.js";
import type { ScheduleCadence, ScheduleExecution, ScheduleRecord } from "@tyrum/contracts";

describe("schedules-page.lib", () => {
  describe("formatInterval", () => {
    it("formats seconds", () => {
      expect(formatInterval(1000)).toBe("1 second");
      expect(formatInterval(5000)).toBe("5 seconds");
    });

    it("formats minutes", () => {
      expect(formatInterval(60_000)).toBe("1 minute");
      expect(formatInterval(300_000)).toBe("5 minutes");
    });

    it("formats hours", () => {
      expect(formatInterval(3_600_000)).toBe("1 hour");
      expect(formatInterval(7_200_000)).toBe("2 hours");
    });

    it("formats days", () => {
      expect(formatInterval(86_400_000)).toBe("1 day");
      expect(formatInterval(172_800_000)).toBe("2 days");
    });

    it("falls back to smaller unit when not evenly divisible", () => {
      expect(formatInterval(90_000)).toBe("90 seconds");
      expect(formatInterval(5_400_000)).toBe("90 minutes");
      expect(formatInterval(3_601_000)).toBe("3601 seconds");
      expect(formatInterval(86_401_000)).toBe("86401 seconds");
    });

    it("handles zero and negative", () => {
      expect(formatInterval(0)).toBe("0s");
      expect(formatInterval(-1)).toBe("0s");
    });
  });

  describe("formatCadence", () => {
    it("formats interval cadence", () => {
      const cadence: ScheduleCadence = { type: "interval", interval_ms: 1_800_000 };
      expect(formatCadence(cadence)).toBe("Every 30 minutes");
    });

    it("formats cron cadence", () => {
      const cadence: ScheduleCadence = {
        type: "cron",
        expression: "0 9 * * 1-5",
        timezone: "America/New_York",
      };
      expect(formatCadence(cadence)).toBe("0 9 * * 1-5 (America/New_York)");
    });
  });

  describe("describeExecution", () => {
    it("describes agent_turn without instruction", () => {
      const execution: ScheduleExecution = { kind: "agent_turn" };
      expect(describeExecution(execution)).toBe("Agent turn");
    });

    it("describes agent_turn with instruction", () => {
      const execution: ScheduleExecution = { kind: "agent_turn", instruction: "Review work" };
      expect(describeExecution(execution)).toBe("Agent turn (with instruction)");
    });

    it("describes playbook", () => {
      const execution: ScheduleExecution = { kind: "playbook", playbook_id: "daily-report" };
      expect(describeExecution(execution)).toBe("Playbook: daily-report");
    });

    it("describes steps", () => {
      const execution: ScheduleExecution = {
        kind: "steps",
        steps: [
          { type: "Web", args: {} },
          { type: "Llm", args: {} },
        ],
      };
      expect(describeExecution(execution)).toBe("2 action steps");
    });

    it("describes single step", () => {
      const execution: ScheduleExecution = {
        kind: "steps",
        steps: [{ type: "Web", args: {} }],
      };
      expect(describeExecution(execution)).toBe("1 action step");
    });
  });

  describe("sortSchedules", () => {
    const base: ScheduleRecord = {
      schedule_id: "a",
      watcher_key: "w",
      kind: "heartbeat",
      enabled: true,
      cadence: { type: "interval", interval_ms: 60_000 },
      execution: { kind: "agent_turn" },
      delivery: { mode: "quiet" },
      seeded_default: false,
      deleted: false,
      target_scope: { agent_key: "agent-1", workspace_key: "ws-1" },
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
      last_fired_at: null,
      next_fire_at: null,
    };

    it("puts enabled before disabled", () => {
      const disabled = { ...base, schedule_id: "b", enabled: false };
      const result = sortSchedules([disabled, base]);
      expect(result[0]?.enabled).toBe(true);
      expect(result[1]?.enabled).toBe(false);
    });

    it("sorts by updated_at desc within same enabled state", () => {
      const older = { ...base, schedule_id: "old", updated_at: "2025-01-01T00:00:00Z" };
      const newer = { ...base, schedule_id: "new", updated_at: "2025-06-01T00:00:00Z" };
      const result = sortSchedules([older, newer]);
      expect(result[0]?.schedule_id).toBe("new");
      expect(result[1]?.schedule_id).toBe("old");
    });

    it("does not mutate the original array", () => {
      const items = [base];
      const result = sortSchedules(items);
      expect(result).not.toBe(items);
    });
  });

  describe("formatAbsoluteTime", () => {
    it("formats valid ISO string", () => {
      const result = formatAbsoluteTime("2025-06-15T12:00:00Z");
      expect(result).toBeTruthy();
      expect(result).not.toBe("2025-06-15T12:00:00Z");
    });

    it("returns input for invalid date", () => {
      expect(formatAbsoluteTime("not-a-date")).toBe("not-a-date");
    });
  });

  describe("cadenceUnitToMs", () => {
    it("converts seconds", () => {
      expect(cadenceUnitToMs(30, "seconds")).toBe(30_000);
    });

    it("converts minutes", () => {
      expect(cadenceUnitToMs(5, "minutes")).toBe(300_000);
    });

    it("converts hours", () => {
      expect(cadenceUnitToMs(2, "hours")).toBe(7_200_000);
    });

    it("converts days", () => {
      expect(cadenceUnitToMs(1, "days")).toBe(86_400_000);
    });
  });
});
