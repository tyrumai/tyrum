import * as React from "react";
import { cn } from "../../lib/cn.js";

export type StatusDotVariant = "neutral" | "primary" | "success" | "warning" | "danger";

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: StatusDotVariant;
  pulse?: boolean;
}

const VARIANT_CLASSES: Record<StatusDotVariant, string> = {
  neutral: "bg-neutral",
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-error",
};

export const StatusDot = React.forwardRef<HTMLSpanElement, StatusDotProps>(
  ({ className, variant = "neutral", pulse = false, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex h-2.5 w-2.5 rounded-full",
          VARIANT_CLASSES[variant],
          pulse ? "animate-pulse" : null,
          className,
        )}
        {...props}
      />
    );
  },
);
StatusDot.displayName = "StatusDot";
