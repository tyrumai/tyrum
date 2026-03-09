import type {
  ActivityAttentionLevel,
  ActivityState,
  ActivityWorkstream,
  OperatorCore,
} from "@tyrum/operator-core";
import { Building2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppPage } from "../layout/app-page.js";
import { Badge, type BadgeVariant } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { EmptyState } from "../ui/empty-state.js";
import { Skeleton } from "../ui/skeleton.js";
import { cn } from "../../lib/cn.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { ActivityScene } from "./activity-scene.js";
import { ACTIVITY_ROOM_LABELS } from "./activity-scene-model.js";

export interface ActivityPageProps {
  core: OperatorCore;
}

const ATTENTION_LABELS: Record<ActivityAttentionLevel, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  idle: "Idle",
};

const ATTENTION_BADGE_VARIANTS: Record<ActivityAttentionLevel, BadgeVariant> = {
  critical: "danger",
  high: "warning",
  medium: "default",
  low: "outline",
  idle: "outline",
};

function formatRunStatus(status: ActivityWorkstream["runStatus"]): string {
  if (!status) return "Idle";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatOccurredAt(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function collectTimelineEvents(activity: ActivityState) {
  return activity.workstreamIds
    .flatMap((workstreamId) => activity.workstreamsById[workstreamId]?.recentEvents ?? [])
    .toSorted((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, 6);
}

function ActorPopover({
  workstream,
  onClose,
}: {
  workstream: ActivityWorkstream;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      data-testid="activity-actor-popover"
      className="absolute right-4 top-4 z-30 w-64 rounded-lg border border-border bg-bg-card p-3 shadow-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-fg">{workstream.persona.name}</div>
          <div className="mt-0.5 text-xs text-fg-muted">{workstream.persona.description}</div>
        </div>
        <Badge variant={ATTENTION_BADGE_VARIANTS[workstream.attentionLevel]}>
          {ATTENTION_LABELS[workstream.attentionLevel]}
        </Badge>
      </div>
      <div className="mt-3 space-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-fg-muted">Room</span>
          <span className="text-fg">{ACTIVITY_ROOM_LABELS[workstream.currentRoom]}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-fg-muted">Status</span>
          <span className="text-fg">{formatRunStatus(workstream.runStatus)}</span>
        </div>
        {workstream.queuedRunCount > 0 && (
          <div className="flex justify-between">
            <span className="text-fg-muted">Queue</span>
            <span className="text-fg">{workstream.queuedRunCount}</span>
          </div>
        )}
        {workstream.bubbleText && (
          <div className="mt-2 rounded border border-border/50 bg-bg/60 px-2 py-1.5 text-xs text-fg-muted">
            {workstream.bubbleText}
          </div>
        )}
      </div>
    </div>
  );
}

export function ActivityPage({ core }: ActivityPageProps) {
  const activity = useOperatorStore(core.activityStore);
  const status = useOperatorStore(core.statusStore);
  const [selectionCleared, setSelectionCleared] = useState(false);

  useEffect(() => {
    if (activity.workstreamIds.length === 0) {
      setSelectionCleared(false);
      return;
    }
    if (activity.selectedWorkstreamId !== null) {
      setSelectionCleared(false);
    }
  }, [activity.selectedWorkstreamId, activity.workstreamIds.length]);

  const isLoading = activity.workstreamIds.length === 0 && status.loading.status;
  const selectedWorkstreamId = selectionCleared
    ? null
    : (activity.selectedWorkstreamId ?? activity.workstreamIds[0] ?? null);
  const selectedWorkstream = selectedWorkstreamId
    ? (activity.workstreamsById[selectedWorkstreamId] ?? null)
    : null;
  const timelineEvents = selectedWorkstream?.recentEvents.length
    ? selectedWorkstream.recentEvents.slice(0, 6)
    : collectTimelineEvents(activity);

  return (
    <AppPage
      title="Activity"
      data-testid="activity-page"
      contentClassName="max-w-5xl gap-3"
      actions={
        <div data-testid="activity-page-filters" className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={selectedWorkstreamId ? "outline" : "secondary"}
            aria-pressed={selectedWorkstreamId === null}
            onClick={() => {
              setSelectionCleared(true);
              core.activityStore.clearSelection();
            }}
          >
            All workstreams
          </Button>
          <Badge variant="outline">{activity.agentIds.length} agents</Badge>
          <Badge variant="outline">{activity.workstreamIds.length} streams</Badge>
        </div>
      }
    >
      <div data-testid="activity-page-scene" className="relative">
        {isLoading ? (
          <div data-testid="activity-page-loading" className="space-y-3 px-4 py-8">
            <p className="text-sm text-fg-muted">Preparing activity scene</p>
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={`activity-scene-skeleton-${index}`} className="h-10 w-full" />
            ))}
          </div>
        ) : activity.workstreamIds.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Scene coming online"
            description="Workstream activity will appear here once agents start flowing."
          />
        ) : (
          <ActivityScene
            activity={activity}
            selectedWorkstreamId={selectedWorkstreamId}
            onSelectWorkstream={(workstreamId) => {
              setSelectionCleared(false);
              core.activityStore.selectWorkstream(workstreamId);
            }}
          />
        )}

        {selectedWorkstream && (
          <ActorPopover
            workstream={selectedWorkstream}
            onClose={() => {
              setSelectionCleared(true);
              core.activityStore.clearSelection();
            }}
          />
        )}
      </div>

      {timelineEvents.length > 0 && (
        <div
          data-testid="activity-page-timeline"
          className={cn(
            "flex flex-col gap-1 px-1",
            selectedWorkstream && "border-l-2 border-primary/30 pl-3",
          )}
        >
          {timelineEvents.map((event) => (
            <div key={event.id} className="flex items-baseline gap-2">
              <span className="shrink-0 text-[11px] tabular-nums text-fg-muted">
                {formatOccurredAt(event.occurredAt)}
              </span>
              <span className="text-xs text-fg">{event.summary}</span>
            </div>
          ))}
        </div>
      )}
    </AppPage>
  );
}
