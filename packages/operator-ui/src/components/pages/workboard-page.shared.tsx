import type { WorkItem } from "@tyrum/operator-app";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "../ui/badge.js";
import { Card, CardContent } from "../ui/card.js";
import { SectionHeading } from "../ui/section-heading.js";
import { StructuredValue } from "../ui/structured-value.js";
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

export function Section({
  title,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!collapsible) {
    return (
      <div className="grid gap-2">
        <SectionHeading>{title}</SectionHeading>
        {children}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <SectionHeading>{title}</SectionHeading>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-fg-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-fg-muted" />
        )}
      </button>
      {open ? children : null}
    </div>
  );
}

export function InlineEmptyHint({ children }: { children: ReactNode }) {
  return <div className="text-sm text-fg-muted">{children}</div>;
}

export function DetailListSection<T>({
  title,
  items,
  renderItem,
  collapsible,
  defaultOpen,
}: {
  title: string;
  items: readonly T[];
  /** @deprecated No longer displayed; empty sections render nothing. */
  empty?: string;
  renderItem: (item: T) => ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <Section title={title} collapsible={collapsible} defaultOpen={defaultOpen}>
      <div className="grid gap-2">{items.map(renderItem)}</div>
    </Section>
  );
}

export function KvSection({
  title,
  entries,
  collapsible,
  defaultOpen,
}: {
  title: string;
  entries: readonly WorkStateKvEntry[];
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <Section title={title} collapsible={collapsible} defaultOpen={defaultOpen}>
      <div className="divide-y divide-border">
        {entries.map((entry) => (
          <div key={entry.key} className="flex items-start justify-between gap-3 py-2">
            <span className="text-sm font-medium text-fg">{entry.key}</span>
            <div className="text-sm text-fg">
              <StructuredValue value={entry.value_json} />
            </div>
          </div>
        ))}
      </div>
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
      data-work-item-id={item.work_item_id}
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
  id,
  role,
  "aria-labelledby": ariaLabelledBy,
}: {
  status: WorkItem["status"];
  items: readonly WorkItem[];
  selectedWorkItemId: string | null;
  onSelect: (workItemId: string) => void;
  id?: string;
  role?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <Card id={id} role={role} aria-labelledby={ariaLabelledBy}>
      <CardContent className="grid gap-2.5 pt-4">
        <div className="flex items-center justify-between gap-2">
          <SectionHeading as="div">{STATUS_LABELS[status]}</SectionHeading>
          <Badge variant="outline">{items.length}</Badge>
        </div>
        <WorkStatusList items={items} selectedWorkItemId={selectedWorkItemId} onSelect={onSelect} />
      </CardContent>
    </Card>
  );
}
