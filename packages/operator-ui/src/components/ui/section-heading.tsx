import * as React from "react";
import { cn } from "../../lib/cn.js";

export type SectionHeadingLevel = "section" | "page" | "subsection";

export interface SectionHeadingProps extends React.HTMLAttributes<HTMLElement> {
  /** Visual size tier. @default "section" */
  level?: SectionHeadingLevel;
  /** Semantic HTML element to render. @default "div" */
  as?: "h1" | "h2" | "h3" | "h4" | "div";
}

const LEVEL_CLASSES: Record<SectionHeadingLevel, string> = {
  page: "text-lg font-medium text-fg",
  section: "text-base font-semibold text-fg",
  subsection: "text-xs font-medium uppercase tracking-wide text-fg-muted",
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
