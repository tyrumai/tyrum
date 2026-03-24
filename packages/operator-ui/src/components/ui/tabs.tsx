import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "../../lib/cn.js";
import { translateNode, translateStringAttribute, useI18n } from "../../i18n-helpers.js";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsPrimitive.TabsListProps
>(({ className, ...props }, ref) => {
  const intl = useI18n();
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1.5 border-b border-border text-fg-muted",
        className,
      )}
      {...props}
      title={translateStringAttribute(intl, props.title)}
      aria-label={translateStringAttribute(intl, props["aria-label"])}
    />
  );
});
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsPrimitive.TabsTriggerProps
>(({ className, children, ...props }, ref) => {
  const intl = useI18n();
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap px-2.5 py-1.5 text-sm font-medium transition-colors duration-150",
        "border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-fg",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
      title={translateStringAttribute(intl, props.title)}
      aria-label={translateStringAttribute(intl, props["aria-label"])}
    >
      {translateNode(intl, children)}
    </TabsPrimitive.Trigger>
  );
});
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  TabsPrimitive.TabsContentProps
>(({ className, ...props }, ref) => {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn(
        "min-w-0 pt-2 data-[state=inactive]:hidden!",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        className,
      )}
      {...props}
    />
  );
});
TabsContent.displayName = "TabsContent";
