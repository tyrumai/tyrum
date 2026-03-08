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

export function AppShell({
  mode,
  sidebar,
  mobileNav,
  fullBleed = false,
  viewportLocked = false,
  children,
  className,
  ...props
}: AppShellProps) {
  const mdUp = useMediaQuery("(min-width: 768px)");
  const showSidebar = mode === "desktop" || mdUp;
  const showMobileNav = mode === "web" && !mdUp;
  const lockViewport = mode === "desktop" || viewportLocked;

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
      <div className={cn("flex", lockViewport ? "h-full min-h-0" : "min-h-screen")}>
        {showSidebar ? sidebar : null}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main
            className={cn(
              "flex-1 min-h-0 overflow-x-hidden",
              fullBleed || viewportLocked ? "overflow-y-hidden" : "overflow-y-auto",
              showMobileNav ? "pb-[calc(3.5rem+env(safe-area-inset-bottom))]" : null,
            )}
          >
            {fullBleed ? (
              children
            ) : (
              <div
                className={cn(
                  "min-w-0 px-4 py-4 md:px-5 md:py-5",
                  mode === "web" ? "mx-auto max-w-7xl" : null,
                  viewportLocked ? "flex h-full min-h-0 flex-col overflow-hidden" : null,
                )}
              >
                {children}
              </div>
            )}
          </main>
          {showMobileNav ? mobileNav : null}
        </div>
      </div>
    </div>
  );
}
