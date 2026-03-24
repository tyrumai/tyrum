import type { ScheduleCadence, ScheduleExecution, ScheduleRecord } from "@tyrum/contracts";
import { formatSharedMessage, getDocumentLocale } from "../../i18n/messages.js";

export function formatInterval(ms: number): string {
  if (ms <= 0) return "0s";

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0 && seconds % 86_400 === 0) {
    return formatSharedMessage("{count, plural, one {# day} other {# days}}", { count: days });
  }
  if (hours > 0 && seconds % 3_600 === 0) {
    return formatSharedMessage("{count, plural, one {# hour} other {# hours}}", { count: hours });
  }
  if (minutes > 0 && seconds % 60 === 0) {
    return formatSharedMessage("{count, plural, one {# minute} other {# minutes}}", {
      count: minutes,
    });
  }
  return formatSharedMessage("{count, plural, one {# second} other {# seconds}}", {
    count: seconds,
  });
}

export function formatCadence(cadence: ScheduleCadence): string {
  if (cadence.type === "interval") {
    return formatSharedMessage("Every {interval}", {
      interval: formatInterval(cadence.interval_ms),
    });
  }
  return `${cadence.expression} (${cadence.timezone})`;
}

export function describeExecution(execution: ScheduleExecution): string {
  switch (execution.kind) {
    case "agent_turn":
      return formatSharedMessage(
        execution.instruction ? "Agent turn (with instruction)" : "Agent turn",
      );
    case "playbook":
      return formatSharedMessage("Playbook: {playbookId}", { playbookId: execution.playbook_id });
    case "steps":
      return formatSharedMessage("{count, plural, one {# action step} other {# action steps}}", {
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

export function formatAbsoluteTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat(getDocumentLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
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
