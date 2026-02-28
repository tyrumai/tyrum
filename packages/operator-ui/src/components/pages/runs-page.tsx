import type { ExecutionAttempt, ExecutionRun, ExecutionStep } from "@tyrum/client";
import type { OperatorCore, RunsState } from "@tyrum/operator-core";
import { ChevronDown, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AttemptArtifactsDialog } from "../artifacts/attempt-artifacts-dialog.js";
import { Badge, type BadgeVariant } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { EmptyState } from "../ui/empty-state.js";
import { StatusDot, type StatusDotVariant } from "../ui/status-dot.js";
import { cn } from "../../lib/cn.js";
import { useOperatorStore } from "../../use-operator-store.js";

const TRUNCATED_ID_CHARS = 8;

function truncateId(id: string): string {
  if (id.length <= TRUNCATED_ID_CHARS) return id;
  return id.slice(-TRUNCATED_ID_CHARS);
}

function formatRelativeTime(iso: string, nowMs = Date.now()): string {
  const timestampMs = Date.parse(iso);
  if (!Number.isFinite(timestampMs)) return "";

  const deltaSeconds = Math.floor((nowMs - timestampMs) / 1000);
  const absSeconds = Math.abs(deltaSeconds);

  if (absSeconds < 10) return "just now";

  const format = (value: number, unit: string) =>
    deltaSeconds < 0 ? `in ${value}${unit}` : `${value}${unit} ago`;

  if (absSeconds < 60) return format(absSeconds, "s");
  const absMinutes = Math.floor(absSeconds / 60);
  if (absMinutes < 60) return format(absMinutes, "m");
  const absHours = Math.floor(absMinutes / 60);
  if (absHours < 24) return format(absHours, "h");
  const absDays = Math.floor(absHours / 24);
  return format(absDays, "d");
}

function formatDurationMs(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "-";
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) {
    const seconds = durationMs / 1000;
    const text = seconds < 10 ? seconds.toFixed(1) : String(Math.round(seconds));
    return `${text.replace(/\.0$/, "")}s`;
  }
  const minutes = Math.floor(durationMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function resolveRunStatusLabel(status: ExecutionRun["status"]): string {
  if (status === "succeeded") return "completed";
  return status;
}

function resolveRunBadgeVariant(status: ExecutionRun["status"]): BadgeVariant {
  switch (status) {
    case "running":
      return "default";
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
    case "paused":
      return "warning";
    case "queued":
    case "cancelled":
    default:
      return "outline";
  }
}

function resolveStepStatusDotVariant(status: ExecutionStep["status"]): StatusDotVariant {
  switch (status) {
    case "running":
      return "primary";
    case "succeeded":
      return "success";
    case "failed":
      return "danger";
    case "paused":
      return "warning";
    case "cancelled":
    case "skipped":
    case "queued":
    default:
      return "neutral";
  }
}

function resolveStepStatusLabel(status: ExecutionStep["status"]): string {
  if (status === "succeeded") return "completed";
  return status;
}

function resolveAttemptStatusDotVariant(status: ExecutionAttempt["status"]): StatusDotVariant {
  switch (status) {
    case "running":
      return "primary";
    case "succeeded":
      return "success";
    case "failed":
    case "timed_out":
      return "danger";
    case "cancelled":
    default:
      return "neutral";
  }
}

function resolveAttemptStatusLabel(status: ExecutionAttempt["status"]): string {
  if (status === "succeeded") return "completed";
  if (status === "timed_out") return "timed out";
  return status;
}

function CopyableId({ id }: { id: string }) {
  const copy = async (): Promise<void> => {
    try {
      await globalThis.navigator.clipboard.writeText(id);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <button
      type="button"
      data-testid={`copy-id-${id}`}
      aria-label={`Copy ID ${id}`}
      title={id}
      className={cn(
        "font-mono text-xs text-fg-muted hover:text-fg",
        "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
      )}
      onClick={() => {
        void copy();
      }}
    >
      {truncateId(id)}
    </button>
  );
}

function buildRunTimeline(
  run: ExecutionRun,
  state: RunsState,
): Array<{ step: ExecutionStep; attempts: ExecutionAttempt[] }> {
  const steps = (state.stepIdsByRunId[run.run_id] ?? [])
    .map((stepId) => state.stepsById[stepId])
    .filter((step): step is ExecutionStep => step !== undefined)
    .sort((a, b) => a.step_index - b.step_index);

  return steps.map((step) => {
    const attempts = (state.attemptIdsByStepId[step.step_id] ?? [])
      .map((attemptId) => state.attemptsById[attemptId])
      .filter((attempt): attempt is ExecutionAttempt => attempt !== undefined)
      .sort((a, b) => a.attempt - b.attempt);

    return { step, attempts };
  });
}

export function RunsPage({ core }: { core: OperatorCore }) {
  const runsState = useOperatorStore(core.runsStore);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(() => new Set());

  const runs = useMemo(() => {
    return Object.values(runsState.runsById).sort((a, b) => {
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });
  }, [runsState.runsById]);

  const toggleRun = (runId: string): void => {
    setExpandedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Runs</h1>

      {runs.length === 0 ? (
        <EmptyState
          icon={Play}
          title="No runs yet"
          description="Runs appear here when agents start executing."
        />
      ) : (
        <div className="grid gap-4">
          {runs.map((run) => {
            const isExpanded = expandedRunIds.has(run.run_id);
            const statusLabel = resolveRunStatusLabel(run.status);
            const badgeVariant = resolveRunBadgeVariant(run.status);
            const relativeTime = formatRelativeTime(run.started_at ?? run.created_at);
            const timeline = isExpanded ? buildRunTimeline(run, runsState) : [];

            return (
              <Card key={run.run_id}>
                <div className="flex items-center justify-between gap-4 p-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-3">
                    <Badge
                      data-testid={`run-status-${run.run_id}`}
                      variant={badgeVariant}
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {statusLabel}
                    </Badge>
                    <CopyableId id={run.run_id} />
                    <span className="text-xs text-fg-muted">{relativeTime}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`run-toggle-${run.run_id}`}
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? "Collapse run" : "Expand run"}
                    onClick={() => {
                      toggleRun(run.run_id);
                    }}
                  >
                    <ChevronDown
                      aria-hidden={true}
                      className={cn(
                        "h-4 w-4 transition-transform",
                        isExpanded ? "rotate-0" : "-rotate-90",
                      )}
                    />
                  </Button>
                </div>

                {isExpanded ? (
                  <div className="grid gap-4 border-t border-border p-4">
                    {timeline.length === 0 ? (
                      <div className="text-sm text-fg-muted">No steps yet.</div>
                    ) : (
                      timeline.map(({ step, attempts }) => {
                        const attemptCount = attempts.length;
                        const stepDotVariant = resolveStepStatusDotVariant(step.status);
                        const stepDotPulse = step.status === "running";
                        const stepStatusLabel = resolveStepStatusLabel(step.status);

                        return (
                          <div key={step.step_id} className="grid gap-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <StatusDot
                                  variant={stepDotVariant}
                                  pulse={stepDotPulse}
                                  aria-hidden={true}
                                />
                                <div className="truncate text-sm font-medium text-fg">
                                  Step {step.step_index} • {step.action.type}
                                </div>
                                <div className="text-xs text-fg-muted">
                                  {stepStatusLabel} • {attemptCount} attempt
                                  {attemptCount === 1 ? "" : "s"}
                                </div>
                              </div>
                              <CopyableId id={step.step_id} />
                            </div>

                            {attemptCount > 0 ? (
                              <div className="ml-4 grid gap-1">
                                {attempts.map((attempt) => {
                                  const attemptDotVariant = resolveAttemptStatusDotVariant(
                                    attempt.status,
                                  );
                                  const attemptDotPulse = attempt.status === "running";
                                  const attemptStatusLabel = resolveAttemptStatusLabel(
                                    attempt.status,
                                  );
                                  const timing =
                                    attempt.finished_at && attempt.started_at
                                      ? formatDurationMs(
                                          Date.parse(attempt.finished_at) -
                                            Date.parse(attempt.started_at),
                                        )
                                      : `started ${formatRelativeTime(attempt.started_at)}`;

                                  return (
                                    <div
                                      key={attempt.attempt_id}
                                      className="flex items-center justify-between gap-3 text-sm"
                                    >
                                      <div className="flex min-w-0 items-center gap-2">
                                        <StatusDot
                                          variant={attemptDotVariant}
                                          pulse={attemptDotPulse}
                                          aria-hidden={true}
                                        />
                                        <div className="text-fg">Attempt {attempt.attempt}</div>
                                        <div className="truncate text-xs text-fg-muted">
                                          {attemptStatusLabel} • {timing}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <AttemptArtifactsDialog
                                          core={core}
                                          runId={run.run_id}
                                          attemptId={attempt.attempt_id}
                                          artifacts={attempt.artifacts}
                                        />
                                        <CopyableId id={attempt.attempt_id} />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
