import * as React from "react";
import { cn } from "../../lib/cn.js";

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ title, breadcrumbs, actions, className, ...props }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 flex flex-col gap-1", className)} {...props}>
      {breadcrumbs ? <div className="text-sm text-fg-muted">{breadcrumbs}</div> : null}
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
