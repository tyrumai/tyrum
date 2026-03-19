import type { WorkItemTaskState } from "@tyrum/contracts";

export function isTerminalTaskState(status: WorkItemTaskState | undefined): boolean {
  return (
    status === "completed" || status === "skipped" || status === "cancelled" || status === "failed"
  );
}
