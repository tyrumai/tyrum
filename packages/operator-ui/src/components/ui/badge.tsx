import * as React from "react";
import { cn } from "../../lib/cn.js";
import { translateNode, translateStringAttribute, useI18n } from "../../i18n-helpers.js";

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "outline";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "border-border bg-bg-subtle text-fg",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-error/25 bg-error/10 text-error",
  outline: "border-border bg-transparent text-fg",
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", children, ...props }, ref) => {
    const intl = useI18n();
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
          VARIANT_CLASSES[variant],
          className,
        )}
        {...props}
        title={translateStringAttribute(intl, props.title)}
        aria-label={translateStringAttribute(intl, props["aria-label"])}
      >
        {translateNode(intl, children)}
      </span>
    );
  },
);
Badge.displayName = "Badge";
