import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../../lib/cn.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";

export interface MobileNavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  testId?: string;
}

export interface MobileNavProps extends React.HTMLAttributes<HTMLElement> {
  items: MobileNavItem[];
  overflowItems: MobileNavItem[];
  activeItemId: string;
  onNavigate: (id: string) => void;
}

export function MobileNav({
  items,
  overflowItems,
  activeItemId,
  onNavigate,
  className,
  ...props
}: MobileNavProps) {
  const overflowActive = overflowItems.some((item) => item.id === activeItemId);

  const renderTab = (item: MobileNavItem) => {
    const Icon = item.icon;
    const active = item.id === activeItemId;
    return (
      <button
        key={item.id}
        type="button"
        data-testid={item.testId ?? `nav-${item.id}`}
        data-active={active ? "true" : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-xs transition-colors",
          "text-fg-muted hover:text-fg",
          active ? "text-fg" : null,
        )}
        onClick={() => {
          onNavigate(item.id);
        }}
      >
        <Icon className="h-5 w-5" />
        <span className="sr-only">{item.label}</span>
      </button>
    );
  };

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-bg-card",
        className,
      )}
      {...props}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-stretch">
        {items.map(renderTab)}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="nav-more"
              data-active={overflowActive ? "true" : undefined}
              aria-current={overflowActive ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-xs transition-colors",
                "text-fg-muted hover:text-fg",
                overflowActive ? "text-fg" : null,
              )}
            >
              <MoreHorizontal className="h-5 w-5" />
              <span className="sr-only">More</span>
            </button>
          </DropdownMenuTrigger>
          {overflowItems.length > 0 ? (
            <DropdownMenuContent align="end" className="mb-2">
              {overflowItems.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  onSelect={() => {
                    onNavigate(item.id);
                  }}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          ) : null}
        </DropdownMenu>
      </div>
    </nav>
  );
}

