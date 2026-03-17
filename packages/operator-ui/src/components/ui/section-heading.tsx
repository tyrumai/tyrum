import * as React from "react";
import { cn } from "../../lib/cn.js";

export type SectionHeadingLevel = "section" | "page";

export interface SectionHeadingProps extends React.HTMLAttributes<HTMLElement> {
  /** Visual size tier. @default "section" */
  level?: SectionHeadingLevel;
  /** Semantic HTML element to render. @default "div" */
  as?: "h1" | "h2" | "h3" | "h4" | "div";
}

const LEVEL_CLASSES: Record<SectionHeadingLevel, string> = {
  section: "text-sm font-medium text-fg",
  page: "text-lg font-medium text-fg",
};

export const SectionHeading = React.forwardRef<HTMLElement, SectionHeadingProps>(
  ({ className, level = "section", as: Component = "div", ...props }, ref) => {
    return (
      <Component
        ref={ref as React.Ref<HTMLDivElement>}
        className={cn(LEVEL_CLASSES[level], className)}
        {...props}
      />
    );
  },
);
SectionHeading.displayName = "SectionHeading";
