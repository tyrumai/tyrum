import type { ScheduleCadence, ScheduleExecution, ScheduleRecord } from "@tyrum/contracts";

export function formatInterval(ms: number): string {
  if (ms <= 0) return "0s";

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0 && hours % 24 === 0) return days === 1 ? "1 day" : `${String(days)} days`;
  if (hours > 0 && minutes % 60 === 0) return hours === 1 ? "1 hour" : `${String(hours)} hours`;
  if (minutes > 0 && seconds % 60 === 0)
    return minutes === 1 ? "1 minute" : `${String(minutes)} minutes`;
  return seconds === 1 ? "1 second" : `${String(seconds)} seconds`;
}

export function formatCadence(cadence: ScheduleCadence): string {
  if (cadence.type === "interval") {
    return `Every ${formatInterval(cadence.interval_ms)}`;
  }
  return `${cadence.expression} (${cadence.timezone})`;
}

export function describeExecution(execution: ScheduleExecution): string {
  switch (execution.kind) {
    case "agent_turn":
      return execution.instruction ? "Agent turn (with instruction)" : "Agent turn";
    case "playbook":
      return `Playbook: ${execution.playbook_id}`;
    case "steps":
      return `${String(execution.steps.length)} action step${execution.steps.length === 1 ? "" : "s"}`;
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
  return date.toLocaleString();
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
