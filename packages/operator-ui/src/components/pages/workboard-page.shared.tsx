import type { WorkItem } from "@tyrum/operator-app";
import type { ReactNode } from "react";
import { Badge } from "../ui/badge.js";
import { Card, CardContent } from "../ui/card.js";
import { SectionHeading } from "../ui/section-heading.js";
import type { WorkStateKvEntry } from "../workboard/workboard-store.js";

export const STATUS_LABELS: Record<WorkItem["status"], string> = {
  backlog: "Backlog",
  ready: "Ready",
  doing: "Doing",
  blocked: "Blocked",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <SectionHeading className="font-semibold">{title}</SectionHeading>
      {children}
    </div>
  );
}

export function InlineEmptyHint({ children }: { children: ReactNode }) {
  return <div className="text-sm text-fg-muted">{children}</div>;
}

export function DetailListSection<T>({
  title,
  items,
  empty,
  renderItem,
}: {
  title: string;
  items: readonly T[];
  empty: string;
  renderItem: (item: T) => ReactNode;
}) {
  return (
    <Section title={title}>
      {items.length === 0 ? (
        <InlineEmptyHint>{empty}</InlineEmptyHint>
      ) : (
        <div className="grid gap-2">{items.map(renderItem)}</div>
      )}
    </Section>
  );
}

export function KvSection({
  title,
  entries,
}: {
  title: string;
  entries: readonly WorkStateKvEntry[];
}) {
  return (
    <Section title={title}>
      {entries.length === 0 ? (
        <InlineEmptyHint>No entries.</InlineEmptyHint>
      ) : (
        <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-bg-subtle p-2.5 font-mono text-xs text-fg [overflow-wrap:anywhere]">
          {entries.map((entry) => `${entry.key} = ${JSON.stringify(entry.value_json)}`).join("\n")}
        </pre>
      )}
    </Section>
  );
}

function WorkItemCard({
  item,
  selectedWorkItemId,
  onSelect,
}: {
  item: WorkItem;
  selectedWorkItemId: string | null;
  onSelect: (workItemId: string) => void;
}) {
  const active = item.work_item_id === selectedWorkItemId;

  return (
    <button
      type="button"
      key={item.work_item_id}
      data-testid={`work-item-${item.work_item_id}`}
      data-active={active ? "true" : undefined}
      className={[
        "grid gap-1.5 rounded-md border px-2.5 py-2.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
        active ? "border-primary bg-bg text-fg" : "border-border bg-bg hover:bg-bg-subtle",
      ].join(" ")}
      onClick={() => onSelect(item.work_item_id)}
    >
      <div className="break-words text-sm font-semibold leading-snug text-fg [overflow-wrap:anywhere]">
        {item.title}
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-fg-muted">
        <span>{item.kind}</span>
        <span>prio {item.priority}</span>
      </div>
      <div className="grid gap-1 text-xs text-fg-muted">
        <span className="font-mono break-all">{item.work_item_id}</span>
        {item.last_active_at ? (
          <span className="break-words [overflow-wrap:anywhere]">
            active {new Date(item.last_active_at).toLocaleString()}
          </span>
        ) : null}
      </div>
    </button>
  );
}

export function WorkStatusList({
  items,
  selectedWorkItemId,
  onSelect,
}: {
  items: readonly WorkItem[];
  selectedWorkItemId: string | null;
  onSelect: (workItemId: string) => void;
}) {
  if (items.length === 0) {
    return <InlineEmptyHint>No items</InlineEmptyHint>;
  }

  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <WorkItemCard
          key={item.work_item_id}
          item={item}
          selectedWorkItemId={selectedWorkItemId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function WorkStatusPanel({
  status,
  items,
  selectedWorkItemId,
  onSelect,
}: {
  status: WorkItem["status"];
  items: readonly WorkItem[];
  selectedWorkItemId: string | null;
  onSelect: (workItemId: string) => void;
}) {
  return (
    <Card>
      <CardContent className="grid gap-2.5 pt-4">
        <div className="flex items-center justify-between gap-2">
          <SectionHeading as="div" className="font-semibold">
            {STATUS_LABELS[status]}
          </SectionHeading>
          <Badge variant="outline">{items.length}</Badge>
        </div>
        <WorkStatusList items={items} selectedWorkItemId={selectedWorkItemId} onSelect={onSelect} />
      </CardContent>
    </Card>
  );
}
