import * as React from "react";
import { cn } from "../../lib/cn.js";
import { ScrollArea } from "../ui/scroll-area.js";

function contentFitsViewport(element: HTMLElement): boolean {
  return element.scrollWidth - element.clientWidth <= 1;
}

export interface AppPageToolbarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  actions?: React.ReactNode;
}

export function AppPageToolbar({ title, actions, className, ...props }: AppPageToolbarProps) {
  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4",
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        {title ? <h1 className="truncate text-sm font-medium text-fg">{title}</h1> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export interface AppPageContentProps extends React.HTMLAttributes<HTMLDivElement> {
  contentClassName?: string;
  scrollAreaClassName?: string;
  scrollAreaRef?: React.Ref<React.ElementRef<typeof ScrollArea>>;
}

export function AppPageContent({
  children,
  className,
  contentClassName,
  scrollAreaClassName,
  scrollAreaRef,
  ...props
}: AppPageContentProps) {
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [centerContent, setCenterContent] = React.useState(true);

  const updateAlignment = React.useCallback(() => {
    const element = contentRef.current;
    if (!element) return;
    const nextCentered = contentFitsViewport(element);
    setCenterContent((current) => (current === nextCentered ? current : nextCentered));
  }, []);

  React.useLayoutEffect(() => {
    updateAlignment();
  });

  React.useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element || typeof ResizeObserver !== "function") {
      return;
    }

    const observer = new ResizeObserver(() => {
      updateAlignment();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [updateAlignment]);

  return (
    <div className={cn("min-h-0 flex-1 overflow-hidden", className)} {...props}>
      <ScrollArea ref={scrollAreaRef} className={cn("h-full", scrollAreaClassName)}>
        <div
          ref={contentRef}
          data-layout-content=""
          data-layout-alignment={centerContent ? "center" : "start"}
          className={cn(
            "grid box-border w-full max-w-5xl gap-5 px-4 py-4 md:px-5 md:py-5",
            centerContent ? "mx-auto" : "ml-0 mr-auto",
            contentClassName,
          )}
        >
          {children}
        </div>
      </ScrollArea>
    </div>
  );
}

export interface AppPageProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  contentClassName?: string;
  scrollAreaClassName?: string;
  scrollAreaRef?: React.Ref<React.ElementRef<typeof ScrollArea>>;
  bodyClassName?: string;
}

export function AppPage({
  title,
  actions,
  children,
  className,
  contentClassName,
  scrollAreaClassName,
  scrollAreaRef,
  bodyClassName,
  ...props
}: AppPageProps) {
  return (
    <div
      className={cn("flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg", className)}
      {...props}
    >
      {title || actions ? <AppPageToolbar title={title} actions={actions} /> : null}
      <AppPageContent
        className={bodyClassName}
        contentClassName={contentClassName}
        scrollAreaClassName={scrollAreaClassName}
        scrollAreaRef={scrollAreaRef}
      >
        {children}
      </AppPageContent>
    </div>
  );
}
