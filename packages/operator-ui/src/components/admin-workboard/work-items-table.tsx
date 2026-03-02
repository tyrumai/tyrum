import * as React from "react";
import { cn } from "../../lib/cn.js";

export type WorkItemsTableItem = {
  work_item_id: string;
  kind: string;
  title: string;
  status: string;
  priority: number;
};

export interface WorkItemsTableProps extends React.HTMLAttributes<HTMLDivElement> {
  items: ReadonlyArray<WorkItemsTableItem>;
}

export function WorkItemsTable({
  items,
  className,
  ...props
}: WorkItemsTableProps): React.ReactElement {
  return (
    <div className={cn("grid gap-2", className)} {...props}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-fg">Items</div>
        <div className="text-xs text-fg-muted">{String(items.length)} total</div>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-bg-subtle text-fg-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Title</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Kind</th>
              <th className="px-3 py-2 text-left font-medium">Priority</th>
              <th className="px-3 py-2 text-left font-medium">ID</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr className="border-t border-border">
                <td className="px-3 py-3 text-fg-muted" colSpan={5}>
                  No work items found.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.work_item_id} className="border-t border-border">
                  <td className="px-3 py-2 text-fg">{item.title}</td>
                  <td className="px-3 py-2 text-fg-muted">{item.status}</td>
                  <td className="px-3 py-2 text-fg-muted">{item.kind}</td>
                  <td className="px-3 py-2 text-fg-muted">{String(item.priority)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-fg-muted">{item.work_item_id}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
