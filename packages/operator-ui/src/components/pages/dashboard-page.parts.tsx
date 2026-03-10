import type { ActivityEvent } from "@tyrum/operator-core";
import type { StatusDotVariant } from "../ui/status-dot.js";
import * as React from "react";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Skeleton } from "../ui/skeleton.js";
import { StatusDot } from "../ui/status-dot.js";
import { cn } from "../../lib/cn.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

export function KpiCard({
  icon: Icon,
  value,
  label,
  subtitle,
  loading = false,
  onClick,
  valueClassName,
  testId,
  ariaLabel,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  value: React.ReactNode;
  label: string;
  subtitle?: React.ReactNode;
  loading?: boolean;
  onClick?: () => void;
  valueClassName?: string;
  testId?: string;
  ariaLabel?: string;
}) {
  const content = (
    <div className="flex flex-col gap-1 p-4">
      <Icon aria-hidden={true} className="h-4 w-4 text-fg-muted" />
      {loading ? (
        <Skeleton className="mt-1 h-8 w-16" />
      ) : (
        <div className={cn("text-2xl font-semibold text-fg", valueClassName)}>{value}</div>
      )}
      <div className="text-sm text-fg-muted">{label}</div>
      {subtitle ? <div className="text-xs text-fg-muted">{subtitle}</div> : null}
    </div>
  );

  if (!onClick) {
    return (
      <Card data-testid={testId} className="min-w-0">
        {content}
      </Card>
    );
  }

  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      className={cn(
        "min-w-0 cursor-pointer rounded-lg border border-border bg-bg-card text-left text-fg shadow-sm",
        "transition-colors hover:bg-bg-subtle",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
      )}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Status Row
// ---------------------------------------------------------------------------

export function StatusRow({
  label,
  value,
  loading = false,
  onClick,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  loading?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  if (!onClick) {
    return (
      <div data-testid={testId} className="flex items-center justify-between gap-3 py-2">
        <span className="text-sm text-fg-muted">{label}</span>
        {loading ? (
          <Skeleton className="h-5 w-16" />
        ) : (
          <span className="text-sm font-medium text-fg">{value}</span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={testId}
      className={cn(
        "flex w-full cursor-pointer items-center justify-between gap-3 rounded py-2 text-left",
        "transition-colors hover:bg-bg-subtle",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
      )}
      onClick={onClick}
    >
      <span className="text-sm text-fg-muted">{label}</span>
      {loading ? (
        <Skeleton className="h-5 w-16" />
      ) : (
        <span className="text-sm font-medium text-fg">{value}</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Work Distribution Bar
// ---------------------------------------------------------------------------

export interface WorkSegment {
  key: string;
  count: number;
  color: string;
  label: string;
}

function SegmentBar({ segments, total }: { segments: WorkSegment[]; total: number }) {
  return (
    <>
      {segments.map(
        (s) =>
          s.count > 0 && (
            <div
              key={s.key}
              className={cn(s.color, "transition-all")}
              style={{ width: `${(s.count / total) * 100}%` }}
            />
          ),
      )}
    </>
  );
}

export function WorkDistributionBar({
  segments,
  total,
  onClick,
}: {
  segments: WorkSegment[];
  total: number;
  onClick?: () => void;
}) {
  const ariaLabel = segments.map((s) => `${s.label}: ${s.count}`).join(", ");

  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-center justify-between pb-2">
        <h3 className="text-sm font-semibold">Work Distribution</h3>
        <span className="text-sm text-fg-muted">{total} total</span>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <div className="py-2 text-center text-sm text-fg-muted">No work items</div>
        ) : (
          <>
            {onClick ? (
              <button
                type="button"
                className={cn(
                  "flex h-3 w-full cursor-pointer overflow-hidden rounded-full",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                )}
                role="img"
                aria-label={`Work distribution: ${ariaLabel}`}
                onClick={onClick}
              >
                <SegmentBar segments={segments} total={total} />
              </button>
            ) : (
              <div
                className="flex h-3 w-full overflow-hidden rounded-full"
                role="img"
                aria-label={`Work distribution: ${ariaLabel}`}
              >
                <SegmentBar segments={segments} total={total} />
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {segments.map(
                (s) =>
                  s.count > 0 && (
                    <div key={s.key} className="flex items-center gap-1.5 text-xs text-fg-muted">
                      <span className={cn("inline-block h-2 w-2 rounded-full", s.color)} />
                      {s.label} ({s.count})
                    </div>
                  ),
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Activity Feed
// ---------------------------------------------------------------------------

const EVENT_DOT_VARIANT: Record<ActivityEvent["type"], StatusDotVariant> = {
  "run.updated": "primary",
  "step.updated": "primary",
  "attempt.updated": "primary",
  "approval.updated": "warning",
  "memory.item.updated": "neutral",
  "typing.started": "success",
  "typing.stopped": "neutral",
  "message.delta": "success",
  "message.final": "success",
  "delivery.receipt": "neutral",
};

export function ActivityFeedItem({
  agentName,
  event,
}: {
  agentName: string;
  event: ActivityEvent;
}) {
  return (
    <li className="flex items-start gap-2.5 py-2">
      <StatusDot
        variant={EVENT_DOT_VARIANT[event.type] ?? "neutral"}
        className="mt-1.5 shrink-0"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-sm text-fg">
            <span className="font-medium">{agentName}</span>{" "}
            <span className="text-fg-muted">{event.summary}</span>
          </span>
          <time dateTime={event.occurredAt} className="shrink-0 text-xs text-fg-muted">
            {formatRelativeTime(event.occurredAt)}
          </time>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Token Usage Bar
// ---------------------------------------------------------------------------

export function TokenUsageBar({
  inputTokens,
  outputTokens,
}: {
  inputTokens: number;
  outputTokens: number;
}) {
  const total = inputTokens + outputTokens;
  if (total === 0) return null;
  const inputPct = (inputTokens / total) * 100;

  return (
    <div className="space-y-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-bg-subtle">
        <div className="bg-primary transition-all" style={{ width: `${inputPct}%` }} />
        <div className="bg-primary/40 transition-all" style={{ width: `${100 - inputPct}%` }} />
      </div>
      <div className="flex justify-between text-xs text-fg-muted">
        <span>Input: {inputTokens.toLocaleString()}</span>
        <span>Output: {outputTokens.toLocaleString()}</span>
      </div>
    </div>
  );
}
