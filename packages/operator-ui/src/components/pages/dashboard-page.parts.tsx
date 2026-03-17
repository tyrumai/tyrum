import type { ActivityEvent } from "@tyrum/operator-core";
import type { StatusResponse } from "@tyrum/client";
import type { StatusDotVariant } from "../ui/status-dot.js";
import * as React from "react";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { SectionHeading } from "../ui/section-heading.js";
import { Skeleton } from "../ui/skeleton.js";
import { StatusDot } from "../ui/status-dot.js";
import { cn } from "../../lib/cn.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";

type ConfigHealthIssue = NonNullable<StatusResponse["config_health"]>["issues"][number];
const MAX_VISIBLE_CONFIG_HEALTH_ISSUES = 3;

function getConfigHealthAction(issue: ConfigHealthIssue): {
  label: "Configure" | "Agents";
  routeId: "configure" | "agents";
} {
  if (issue.target.kind === "agent") {
    return { label: "Agents", routeId: "agents" };
  }
  return { label: "Configure", routeId: "configure" };
}

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
        <SectionHeading as="h3" className="font-semibold">
          Work Distribution
        </SectionHeading>
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

export function ConfigHealthCard({
  issues,
  onNavigate,
  onboardingAvailable = false,
  onOpenOnboarding,
}: {
  issues: ConfigHealthIssue[];
  onNavigate?: (id: string) => void;
  onboardingAvailable?: boolean;
  onOpenOnboarding?: () => void;
}) {
  const [showAllIssues, setShowAllIssues] = React.useState(false);

  React.useEffect(() => {
    if (issues.length <= MAX_VISIBLE_CONFIG_HEALTH_ISSUES && showAllIssues) {
      setShowAllIssues(false);
    }
  }, [issues.length, showAllIssues]);

  const issueCounts = React.useMemo(
    () =>
      issues.reduce(
        (counts, issue) => {
          if (issue.severity === "error") {
            counts.error += 1;
          } else {
            counts.warning += 1;
          }
          return counts;
        },
        { error: 0, warning: 0 },
      ),
    [issues],
  );

  const visibleIssues = showAllIssues ? issues : issues.slice(0, MAX_VISIBLE_CONFIG_HEALTH_ISSUES);
  const hiddenIssuesCount = Math.max(0, issues.length - visibleIssues.length);

  return (
    <Card data-testid="dashboard-config-health">
      <CardHeader className="pb-2.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <SectionHeading as="h3" className="font-semibold">
              Configuration Health
            </SectionHeading>
            <div className="text-sm text-fg-muted">
              Resolve configuration issues before agents can run reliably.
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              {issueCounts.error > 0 ? (
                <Badge variant="danger">{issueCounts.error} errors</Badge>
              ) : null}
              {issueCounts.warning > 0 ? (
                <Badge variant="warning">{issueCounts.warning} warnings</Badge>
              ) : null}
              {issues.length > MAX_VISIBLE_CONFIG_HEALTH_ISSUES ? (
                <span>
                  Showing {visibleIssues.length} of {issues.length} issues.
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {issues.length > MAX_VISIBLE_CONFIG_HEALTH_ISSUES ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                data-testid="dashboard-config-health-toggle"
                onClick={() => {
                  setShowAllIssues((current) => !current);
                }}
              >
                {showAllIssues ? "Show fewer issues" : `Show all ${issues.length} issues`}
              </Button>
            ) : null}
            {onboardingAvailable && onOpenOnboarding ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                data-testid="dashboard-resume-setup"
                onClick={() => {
                  onOpenOnboarding();
                }}
              >
                Resume Setup
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {visibleIssues.map((issue, index) => {
          const action = getConfigHealthAction(issue);
          return (
            <div
              key={`${issue.code}:${issue.target.kind}:${issue.target.id ?? "deployment"}:${index}`}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/70 px-3 py-3"
            >
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={issue.severity === "error" ? "danger" : "warning"}>
                    {issue.severity}
                  </Badge>
                  <div className="text-sm font-medium text-fg">{issue.message}</div>
                </div>
                {issue.target.id ? (
                  <div className="text-xs text-fg-muted">
                    {issue.target.kind === "agent" ? "Agent" : "Target"}: {issue.target.id}
                  </div>
                ) : null}
              </div>
              {onNavigate ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onNavigate(action.routeId)}
                >
                  {action.label}
                </Button>
              ) : null}
            </div>
          );
        })}
        {hiddenIssuesCount > 0 && !showAllIssues ? (
          <div className="text-sm text-fg-muted">
            {hiddenIssuesCount} more issues hidden until you expand this list.
          </div>
        ) : null}
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
