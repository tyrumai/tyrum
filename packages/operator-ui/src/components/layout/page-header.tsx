import * as React from "react";
import { cn } from "../../lib/cn.js";

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ title, breadcrumbs, actions, className, ...props }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 flex flex-col gap-1", className)} {...props}>
      {breadcrumbs ? <div className="text-sm text-fg-muted">{breadcrumbs}</div> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
