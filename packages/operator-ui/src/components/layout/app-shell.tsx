import * as React from "react";
import { useMediaQuery } from "../../hooks/use-media-query.js";
import { cn } from "../../lib/cn.js";

export type AppShellMode = "web" | "desktop";

export interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
  mode: AppShellMode;
  sidebar: React.ReactNode;
  mobileNav: React.ReactNode;
  fullBleed?: boolean;
  viewportLocked?: boolean;
}

const AppShellContentWidthContext = React.createContext<number | null>(null);

export function useAppShellMinWidth(minWidthPx: number): boolean {
  const contentWidth = React.useContext(AppShellContentWidthContext);
  const viewportMatches = useMediaQuery(`(min-width: ${String(minWidthPx)}px)`);
  if (contentWidth === null) {
    return viewportMatches;
  }
  return contentWidth >= minWidthPx;
}

export function AppShell({
  mode,
  sidebar,
  mobileNav,
  fullBleed = true,
  viewportLocked = false,
  children,
  className,
  ...props
}: AppShellProps) {
  const mdUp = useMediaQuery("(min-width: 768px)");
  const showSidebar = mode === "desktop" || mdUp;
  const showMobileNav = mode === "web" && !mdUp;
  const lockViewport = mode === "desktop" || viewportLocked;
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = React.useState<number | null>(null);

  React.useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) {
      return;
    }

    const updateWidth = (width: number) => {
      setContentWidth(Math.round(width));
    };

    updateWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver !== "function") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      updateWidth(entry?.contentRect.width ?? element.getBoundingClientRect().width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      className={cn(
        "bg-bg text-fg font-sans antialiased overflow-hidden",
        mode === "desktop" ? "h-screen" : lockViewport ? "h-dvh" : "min-h-screen",
        className,
      )}
      style={{ backgroundImage: "var(--tyrum-app-bg-image)" }}
      {...props}
    >
      <AppShellContentWidthContext.Provider value={contentWidth}>
        <div className={cn("flex", lockViewport ? "h-full min-h-0" : "min-h-screen")}>
          {showSidebar ? sidebar : null}
          <div ref={contentRef} className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <main
              className={cn(
                "flex flex-1 min-h-0 flex-col overflow-x-hidden",
                fullBleed || viewportLocked ? "overflow-y-hidden" : "overflow-y-auto",
                showMobileNav ? "pb-[calc(3.5rem+env(safe-area-inset-bottom))]" : null,
              )}
            >
              {fullBleed ? (
                <div className="flex h-full min-h-0 flex-col overflow-hidden">{children}</div>
              ) : (
                <div
                  className={cn(
                    "flex-1 min-h-0 px-4 py-4 md:px-5 md:py-5",
                    mode === "web" ? "mx-auto w-full max-w-7xl" : null,
                    viewportLocked ? "flex flex-col overflow-hidden" : null,
                  )}
                >
                  {children}
                </div>
              )}
            </main>
            {showMobileNav ? mobileNav : null}
          </div>
        </div>
      </AppShellContentWidthContext.Provider>
    </div>
  );
}
