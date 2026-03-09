import type {
  ActivityAttentionLevel,
  ActivityState,
  ActivityWorkstream,
  OperatorCore,
} from "@tyrum/operator-core";
import { Building2, Orbit, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
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

function Section({
  title,
  description,
  testId,
  className,
  children,
}: {
  title: string;
  description: string;
  testId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg-card/60",
        className,
      )}
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <p className="mt-1 text-xs text-fg-muted">{description}</p>
      </div>
      <div className="min-h-0 flex-1 p-4">{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/70 py-2 last:border-b-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">{label}</dt>
      <dd className="text-right text-sm text-fg">{value}</dd>
    </div>
  );
}

function formatRunStatus(status: ActivityWorkstream["runStatus"]): string {
  if (!status) return "Idle";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatOccurredAt(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function collectTimelineEvents(activity: ActivityState) {
  return activity.workstreamIds
    .flatMap((workstreamId) => activity.workstreamsById[workstreamId]?.recentEvents ?? [])
    .toSorted((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, 8);
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
    ? selectedWorkstream.recentEvents
    : collectTimelineEvents(activity);

  return (
    <AppPage
      title="Activity"
      data-testid="activity-page"
      contentClassName="max-w-6xl gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)]"
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
      <Section
        title="Scene"
        description="Reserved for the animated building scene and room-level workstream cues."
        testId="activity-page-scene"
      >
        {isLoading ? (
          <div
            data-testid="activity-page-loading"
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          >
            <div className="sm:col-span-2 xl:col-span-3">
              <p className="text-sm text-fg-muted">Preparing activity scene</p>
            </div>
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={`activity-scene-skeleton-${index}`}
                className="rounded-lg border border-border/70 bg-bg-subtle/50 p-3"
              >
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-3 h-10 w-full" />
                <Skeleton className="mt-2 h-4 w-20" />
              </div>
            ))}
          </div>
        ) : activity.workstreamIds.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Scene coming online"
            description="The Activity page shell is ready. Workstream cards and the animated building scene will appear here once activity starts flowing."
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
      </Section>

      <Section
        title="Inspector"
        description="Selected workstream details, persona context, and attention signals."
        testId="activity-page-inspector"
      >
        {selectedWorkstream ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/70 bg-bg-subtle/50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-fg">
                    {selectedWorkstream.persona.name}
                  </h3>
                  <p className="mt-1 text-sm text-fg-muted">
                    {selectedWorkstream.persona.description || "No persona description available."}
                  </p>
                </div>
                <Badge variant={ATTENTION_BADGE_VARIANTS[selectedWorkstream.attentionLevel]}>
                  {ATTENTION_LABELS[selectedWorkstream.attentionLevel]}
                </Badge>
              </div>
            </div>

            <dl className="rounded-lg border border-border/70 bg-bg-subtle/50 px-4">
              <DetailRow
                label="Room"
                value={ACTIVITY_ROOM_LABELS[selectedWorkstream.currentRoom]}
              />
              <DetailRow
                label="Lane"
                value={selectedWorkstream.lane === "main" ? "Main" : selectedWorkstream.lane}
              />
              <DetailRow label="Run" value={selectedWorkstream.latestRunId ?? "No run yet"} />
              <DetailRow label="Status" value={formatRunStatus(selectedWorkstream.runStatus)} />
              <DetailRow label="Queue" value={String(selectedWorkstream.queuedRunCount)} />
              <DetailRow
                label="Lease"
                value={
                  selectedWorkstream.lease.active
                    ? (selectedWorkstream.lease.owner ?? "Active")
                    : "Open"
                }
              />
            </dl>

            <div className="rounded-lg border border-border/70 bg-bg-subtle/50 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-fg">
                <Orbit className="h-4 w-4" aria-hidden={true} />
                Bubble text
              </div>
              <p className="mt-2 text-sm text-fg">
                {selectedWorkstream.bubbleText ?? "No live bubble text yet."}
              </p>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={Sparkles}
            title="No workstream selected"
            description="Choose a workstream from the scene to inspect its room, run status, queue depth, and recent events."
          />
        )}
      </Section>

      <Section
        title="Recent activity"
        description="Recent events for the selected workstream, or the freshest activity across the scene."
        testId="activity-page-timeline"
        className="lg:col-span-2"
      >
        {timelineEvents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/70 bg-bg-subtle/30 px-4 py-6 text-sm text-fg-muted">
            No activity events yet.
          </div>
        ) : (
          <ol className="space-y-3">
            {timelineEvents.map((event) => (
              <li
                key={event.id}
                className="rounded-lg border border-border/70 bg-bg-subtle/40 px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium text-fg">{event.summary}</div>
                  <div className="text-xs text-fg-muted">{formatOccurredAt(event.occurredAt)}</div>
                </div>
                <div className="mt-1 text-xs uppercase tracking-wide text-fg-muted">
                  {event.type.replaceAll(".", " ")}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </AppPage>
  );
}
