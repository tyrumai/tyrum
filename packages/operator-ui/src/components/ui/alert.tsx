import * as React from "react";
import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/cn.js";

export type AlertVariant = "info" | "success" | "warning" | "error";

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  variant?: AlertVariant;
  title: React.ReactNode;
  description?: React.ReactNode;
}

const VARIANT_STYLES: Record<
  AlertVariant,
  { container: string; icon: string; Icon: React.ElementType }
> = {
  info: {
    container: "border-primary/30 bg-primary-dim/20",
    icon: "text-primary",
    Icon: Info,
  },
  success: {
    container: "border-success/30 bg-success/10",
    icon: "text-success",
    Icon: CircleCheck,
  },
  warning: {
    container: "border-warning/30 bg-warning/10",
    icon: "text-warning",
    Icon: TriangleAlert,
  },
  error: {
    container: "border-error/30 bg-error/10",
    icon: "text-error",
    Icon: CircleX,
  },
};

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant = "info", title, description, ...props }, ref) => {
    const styles = VARIANT_STYLES[variant];
    const Icon = styles.Icon;

    return (
      <div
        ref={ref}
        role="alert"
        className={cn(
          "box-border w-full rounded-lg border p-4 text-fg",
          "bg-bg-card",
          styles.container,
          className,
        )}
        {...props}
      >
        <div className="flex gap-3">
          <Icon aria-hidden="true" className={cn("mt-0.5 h-5 w-5 shrink-0", styles.icon)} />
          <div className="min-w-0 flex-1">
            <div className="font-medium leading-none">{title}</div>
            {description ? (
              <div className="mt-1 text-sm text-fg-muted break-words break-all">{description}</div>
            ) : null}
          </div>
        </div>
      </div>
    );
  },
);
Alert.displayName = "Alert";
