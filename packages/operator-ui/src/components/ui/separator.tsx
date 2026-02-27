import * as SeparatorPrimitive from "@radix-ui/react-separator";
import * as React from "react";
import { cn } from "../../lib/cn.js";

export const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  SeparatorPrimitive.SeparatorProps
>(({ className, orientation = "horizontal", decorative = false, ...props }, ref) => {
  return (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
});
Separator.displayName = "Separator";
