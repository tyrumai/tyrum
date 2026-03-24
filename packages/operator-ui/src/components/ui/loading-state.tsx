import * as React from "react";
import { cn } from "../../lib/cn.js";
import { Spinner } from "./spinner.js";

export type LoadingStateVariant = "inline" | "centered";

export interface LoadingStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Text displayed alongside the spinner. @default "Loading\u2026" */
  label?: React.ReactNode;
  /** Layout variant. @default "inline" */
  variant?: LoadingStateVariant;
}

const VARIANT_CLASSES: Record<LoadingStateVariant, string> = {
  inline: "flex items-center gap-2 text-sm text-fg-muted",
  centered: "flex items-center justify-center gap-2 px-4 py-10 text-sm text-fg-muted",
};

export const LoadingState = React.forwardRef<HTMLDivElement, LoadingStateProps>(
  ({ className, variant = "inline", label = "Loading\u2026", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(VARIANT_CLASSES[variant], className)}
        role="status"
        aria-busy="true"
        {...props}
      >
        <Spinner className="h-4 w-4" aria-hidden={true} />
        <span>{label}</span>
      </div>
    );
  },
);
LoadingState.displayName = "LoadingState";
