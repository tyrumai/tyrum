import * as React from "react";
import { useMediaQuery } from "../../hooks/use-media-query.js";
import { cn } from "../../lib/cn.js";

export type AppShellMode = "web" | "desktop";

export interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
  mode: AppShellMode;
  sidebar: React.ReactNode;
  mobileNav: React.ReactNode;
  fullBleed?: boolean;
}

export function AppShell({
  mode,
  sidebar,
  mobileNav,
  fullBleed = false,
  children,
  className,
  ...props
}: AppShellProps) {
  const mdUp = useMediaQuery("(min-width: 768px)");
  const showSidebar = mode === "desktop" || mdUp;
  const showMobileNav = mode === "web" && !mdUp;

  return (
    <div
      className={cn(
        "bg-bg text-fg font-sans antialiased overflow-hidden",
        mode === "desktop" ? "h-screen" : "min-h-screen",
        className,
      )}
      {...props}
    >
      <div className={cn("flex", mode === "desktop" ? "h-full" : "min-h-screen")}>
        {showSidebar ? sidebar : null}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main
            className={cn(
              "flex-1 overflow-x-hidden",
              fullBleed ? "overflow-y-hidden" : "overflow-y-auto",
              showMobileNav ? "pb-[calc(4rem+env(safe-area-inset-bottom))]" : null,
            )}
          >
            {fullBleed ? (
              children
            ) : (
              <div className={cn("min-w-0 px-4 py-6", mode === "web" ? "mx-auto max-w-6xl" : null)}>
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
