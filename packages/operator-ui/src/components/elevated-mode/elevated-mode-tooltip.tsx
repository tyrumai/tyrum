import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip.js";

export function ElevatedModeTooltip({
  canMutate,
  requestEnter,
  children,
}: {
  canMutate: boolean;
  requestEnter: () => void;
  children: ReactNode;
}): ReactNode {
  if (canMutate) return children;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="button"
            tabIndex={0}
            data-elevated-mode-guard=""
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              requestEnter();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                requestEnter();
              }
            }}
            className="inline-flex cursor-not-allowed"
          >
            {/* Prevent nested disabled controls from compounding the shared muted state. */}
            <span className="pointer-events-none opacity-50 [&_:disabled]:!opacity-100">
              {children}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">Admin access required</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
