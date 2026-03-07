import type { WorkItem } from "@tyrum/operator-core";
import type { ReactNode } from "react";
import { Badge } from "../ui/badge.js";
import { Card, CardContent } from "../ui/card.js";
import type { WorkStateKvEntry } from "../workboard/workboard-store.js";

const STATUS_LABELS: Record<WorkItem["status"], string> = {
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
      <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</div>
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
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
        <EmptyState>{empty}</EmptyState>
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
        <EmptyState>No entries.</EmptyState>
      ) : (
        <pre className="whitespace-pre-wrap break-all rounded-md border border-border bg-bg-subtle p-3 font-mono text-xs text-fg">
          {entries.map((entry) => `${entry.key} = ${JSON.stringify(entry.value_json)}`).join("\n")}
        </pre>
      )}
    </Section>
  );
}

export function WorkItemColumn({
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
    <Card className="w-64 shrink-0">
      <CardContent className="grid gap-3 pt-6">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-fg">{STATUS_LABELS[status]}</span>
          <Badge variant="outline">{items.length}</Badge>
        </div>
        {items.length === 0 ? (
          <EmptyState>No items</EmptyState>
        ) : (
          <div className="grid gap-2">
            {items.map((item) => {
              const active = item.work_item_id === selectedWorkItemId;
              return (
                <div
                  key={item.work_item_id}
                  className={[
                    "cursor-pointer rounded-lg border p-3 transition-colors",
                    active ? "border-primary bg-primary-dim" : "border-border bg-bg-subtle hover:bg-bg",
                  ].join(" ")}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(item.work_item_id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") onSelect(item.work_item_id);
                  }}
                >
                  <div className="text-sm font-semibold leading-snug text-fg">{item.title}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-fg-muted">
                    <span>{item.kind}</span>
                    <span>prio {item.priority}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-fg-muted">
                    <span>
                      <span className="text-fg-muted">id</span>{" "}
                      <span className="font-mono">{item.work_item_id.slice(0, 8)}</span>
                    </span>
                    {item.last_active_at ? (
                      <span>active {new Date(item.last_active_at).toLocaleString()}</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
