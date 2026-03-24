import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";
import { cn } from "../../lib/cn.js";
import { translateNode, translateStringAttribute, useI18n } from "../../i18n-helpers.js";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  TooltipPrimitive.TooltipContentProps
>(({ className, sideOffset = 4, children, ...props }, ref) => {
  const intl = useI18n();
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-50 overflow-hidden rounded-md border border-border bg-bg-card px-3 py-1.5 text-xs font-sans text-fg shadow-md",
          "data-[state=delayed-open]:tyrum-animate-fade-in data-[state=closed]:tyrum-animate-fade-out",
          className,
        )}
        {...props}
        aria-label={translateStringAttribute(intl, props["aria-label"])}
      >
        {translateNode(intl, children)}
        <TooltipPrimitive.Arrow data-tooltip-arrow="" className="fill-bg-card stroke-border" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = "TooltipContent";
