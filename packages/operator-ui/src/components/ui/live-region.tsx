import * as React from "react";
import { cn } from "../../lib/cn.js";

export type LiveRegionPoliteness = "off" | "polite" | "assertive";

export interface LiveRegionProps extends React.HTMLAttributes<HTMLDivElement> {
  "aria-live"?: LiveRegionPoliteness;
  "aria-atomic"?: React.AriaAttributes["aria-atomic"];
}

export const LiveRegion = React.forwardRef<HTMLDivElement, LiveRegionProps>(
  (
    { className, "aria-live": ariaLive = "polite", "aria-atomic": ariaAtomic = true, ...props },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        className={cn("sr-only", className)}
        aria-live={ariaLive}
        aria-atomic={ariaAtomic}
        {...props}
      />
    );
  },
);
LiveRegion.displayName = "LiveRegion";

