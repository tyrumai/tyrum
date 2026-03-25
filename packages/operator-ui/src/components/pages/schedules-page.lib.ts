import type { ScheduleCadence, ScheduleExecution, ScheduleRecord } from "@tyrum/contracts";
import type { IntlShape } from "react-intl";
import { translateString } from "../../i18n-helpers.js";

export function formatInterval(intl: IntlShape, ms: number): string {
  if (ms <= 0) return "0s";

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0 && seconds % 86_400 === 0) {
    return translateString(intl, "{count, plural, one {# day} other {# days}}", { count: days });
  }
  if (hours > 0 && seconds % 3_600 === 0) {
    return translateString(intl, "{count, plural, one {# hour} other {# hours}}", {
      count: hours,
    });
  }
  if (minutes > 0 && seconds % 60 === 0) {
    return translateString(intl, "{count, plural, one {# minute} other {# minutes}}", {
      count: minutes,
    });
  }
  return translateString(intl, "{count, plural, one {# second} other {# seconds}}", {
    count: seconds,
  });
}

export function formatCadence(intl: IntlShape, cadence: ScheduleCadence): string {
  if (cadence.type === "interval") {
    return translateString(intl, "Every {interval}", {
      interval: formatInterval(intl, cadence.interval_ms),
    });
  }
  return `${cadence.expression} (${cadence.timezone})`;
}

export function describeExecution(intl: IntlShape, execution: ScheduleExecution): string {
  switch (execution.kind) {
    case "agent_turn":
      return translateString(
        intl,
        execution.instruction ? "Agent turn (with instruction)" : "Agent turn",
      );
    case "playbook":
      return translateString(intl, "Playbook: {playbookId}", { playbookId: execution.playbook_id });
    case "steps":
      return translateString(intl, "{count, plural, one {# action step} other {# action steps}}", {
        count: execution.steps.length,
      });
  }
}

export function sortSchedules(items: readonly ScheduleRecord[]): ScheduleRecord[] {
  return [...items].toSorted((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return b.updated_at.localeCompare(a.updated_at);
  });
}

export function formatAbsoluteTime(intl: IntlShape, iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return intl.formatDate(date, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export type CadenceUnit = "seconds" | "minutes" | "hours" | "days";

export function cadenceUnitToMs(value: number, unit: CadenceUnit): number {
  switch (unit) {
    case "seconds":
      return value * 1000;
    case "minutes":
      return value * 60_000;
    case "hours":
      return value * 3_600_000;
    case "days":
      return value * 86_400_000;
  }
}
