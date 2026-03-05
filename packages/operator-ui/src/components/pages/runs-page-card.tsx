import type { ExecutionAttempt, ExecutionRun, ExecutionStep } from "@tyrum/client";
import type { OperatorCore } from "@tyrum/operator-core";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { AttemptArtifactsDialog } from "../artifacts/attempt-artifacts-dialog.js";
import { Badge, type BadgeVariant } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { StatusDot, type StatusDotVariant } from "../ui/status-dot.js";
import { cn } from "../../lib/cn.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import type { RunTimelineEntry } from "./runs-page.lib.js";

const TRUNCATED_ID_CHARS = 8;

function truncateId(id: string): string {
  if (id.length <= TRUNCATED_ID_CHARS) return id;
  return id.slice(-TRUNCATED_ID_CHARS);
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

interface RunsPageCardProps {
  core: OperatorCore;
  run: ExecutionRun;
  isExpanded: boolean;
  onToggleRun: (runId: string) => void;
  timeline: RunTimelineEntry[];
}

export function RunsPageCard({ core, run, isExpanded, onToggleRun, timeline }: RunsPageCardProps) {
  const statusLabel = resolveRunStatusLabel(run.status);
  const badgeVariant = resolveRunBadgeVariant(run.status);
  const relativeTime = formatRelativeTime(run.started_at ?? run.created_at);

  return (
    <Card>
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
            onToggleRun(run.run_id);
          }}
        >
          <ChevronDown
            aria-hidden={true}
            className={cn("h-4 w-4 transition-transform", isExpanded ? "rotate-0" : "-rotate-90")}
          />
        </Button>
      </div>

      {isExpanded ? <RunTimeline core={core} runId={run.run_id} timeline={timeline} /> : null}
    </Card>
  );
}

function RunTimeline({
  core,
  runId,
  timeline,
}: {
  core: OperatorCore;
  runId: string;
  timeline: RunTimelineEntry[];
}) {
  return (
    <div className="grid gap-4 border-t border-border p-4">
      {timeline.length === 0 ? (
        <div className="text-sm text-fg-muted">No steps yet.</div>
      ) : (
        timeline.map(({ step, attempts }) => {
          return (
            <RunTimelineStep
              key={step.step_id}
              core={core}
              runId={runId}
              step={step}
              attempts={attempts}
            />
          );
        })
      )}
    </div>
  );
}

function RunTimelineStep({
  core,
  runId,
  step,
  attempts,
}: {
  core: OperatorCore;
  runId: string;
  step: ExecutionStep;
  attempts: ExecutionAttempt[];
}) {
  const attemptCount = attempts.length;
  const stepDotVariant = resolveStepStatusDotVariant(step.status);
  const stepStatusLabel = resolveStepStatusLabel(step.status);

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot
            variant={stepDotVariant}
            pulse={step.status === "running"}
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
            return (
              <RunAttemptRow key={attempt.attempt_id} core={core} runId={runId} attempt={attempt} />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function RunAttemptRow({
  core,
  runId,
  attempt,
}: {
  core: OperatorCore;
  runId: string;
  attempt: ExecutionAttempt;
}) {
  const timing =
    attempt.finished_at && attempt.started_at
      ? formatDurationMs(Date.parse(attempt.finished_at) - Date.parse(attempt.started_at))
      : `started ${formatRelativeTime(attempt.started_at)}`;

  return (
    <div key={attempt.attempt_id} className="flex items-center justify-between gap-3 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot
          variant={resolveAttemptStatusDotVariant(attempt.status)}
          pulse={attempt.status === "running"}
          aria-hidden={true}
        />
        <div className="text-fg">Attempt {attempt.attempt}</div>
        <div className="truncate text-xs text-fg-muted">
          {resolveAttemptStatusLabel(attempt.status)} • {timing}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <AttemptArtifactsDialog
          core={core}
          runId={runId}
          attemptId={attempt.attempt_id}
          artifacts={attempt.artifacts}
        />
        <CopyableId id={attempt.attempt_id} />
      </div>
    </div>
  );
}
