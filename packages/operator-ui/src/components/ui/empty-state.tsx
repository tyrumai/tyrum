import * as React from "react";
import type { ButtonSize, ButtonVariant } from "./button.js";
import { Button } from "./button.js";
import { cn } from "../../lib/cn.js";

export interface EmptyStateAction {
  label: React.ReactNode;
  onClick: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: EmptyStateAction;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}
      {...props}
    >
      <Icon aria-hidden="true" className="h-12 w-12 text-fg-muted" />
      <div className="mt-4 text-lg font-medium text-fg">{title}</div>
      {description ? (
        <div className="mt-2 max-w-prose text-sm text-fg-muted">{description}</div>
      ) : null}
      {action ? (
        <div className="mt-6">
          <Button
            variant={action.variant}
            size={action.size}
            onClick={action.onClick}
            type="button"
          >
            {action.label}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
