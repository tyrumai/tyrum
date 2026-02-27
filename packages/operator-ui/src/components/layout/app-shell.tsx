import * as React from "react";
import { useMediaQuery } from "../../hooks/use-media-query.js";
import { cn } from "../../lib/cn.js";

export type AppShellMode = "web" | "desktop";

export interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
  mode: AppShellMode;
  sidebar: React.ReactNode;
  mobileNav: React.ReactNode;
}

export function AppShell({
  mode,
  sidebar,
  mobileNav,
  children,
  className,
  ...props
}: AppShellProps) {
  const mdUp = useMediaQuery("(min-width: 768px)");
  const showSidebar = mode === "desktop" || mdUp;
  const showMobileNav = mode === "web" && !mdUp;

  return (
    <div className={cn("min-h-screen bg-bg text-fg font-sans antialiased", className)} {...props}>
      <div className="flex min-h-screen">
        {showSidebar ? sidebar : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <main
            className={cn(
              "flex-1 overflow-y-auto",
              showMobileNav ? "pb-[calc(4rem+env(safe-area-inset-bottom))]" : null,
            )}
          >
            <div className="mx-auto w-full max-w-6xl px-4 py-6">{children}</div>
          </main>
          {showMobileNav ? mobileNav : null}
        </div>
      </div>
    </div>
  );
}
