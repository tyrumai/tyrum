import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "../../lib/cn.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";

export interface MobileNavItem {
  id: string;
  label: string;
  mobileLabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  testId?: string;
}

export interface MobileOverflowGroup {
  id: string;
  label: string;
  items: MobileNavItem[];
}

export interface MobileNavProps extends React.HTMLAttributes<HTMLElement> {
  items: MobileNavItem[];
  overflowItems: MobileNavItem[];
  overflowGroups?: MobileOverflowGroup[];
  activeItemId: string;
  onNavigate: (id: string) => void;
}

export function MobileNav({
  items,
  overflowItems,
  overflowGroups,
  activeItemId,
  onNavigate,
  className,
  ...props
}: MobileNavProps) {
  const allOverflowItems = overflowGroups ? overflowGroups.flatMap((g) => g.items) : overflowItems;
  const overflowActive = allOverflowItems.some((item) => item.id === activeItemId);

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
          "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 py-1 text-[10px] transition-colors",
          "text-fg-muted hover:text-fg",
          "rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
          active ? "text-fg" : null,
        )}
        onClick={() => {
          onNavigate(item.id);
        }}
      >
        <Icon className="h-5 w-5" />
        <span className="max-w-full truncate leading-none">{item.mobileLabel ?? item.label}</span>
      </button>
    );
  };

  return (
    <nav
      aria-label="Mobile navigation"
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-bg-subtle pb-[env(safe-area-inset-bottom)]",
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
                "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 py-1 text-[10px] transition-colors",
                "text-fg-muted hover:text-fg",
                "rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                overflowActive ? "text-fg" : null,
              )}
            >
              <MoreHorizontal className="h-5 w-5" />
              <span className="max-w-full truncate leading-none">More</span>
            </button>
          </DropdownMenuTrigger>
          {allOverflowItems.length > 0 ? (
            <DropdownMenuContent align="end" className="mb-2">
              {overflowGroups
                ? overflowGroups.map((group, groupIndex) => (
                    <React.Fragment key={group.id}>
                      {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                      <DropdownMenuGroup>
                        {group.items.map((item) => (
                          <DropdownMenuItem
                            key={item.id}
                            onSelect={() => {
                              onNavigate(item.id);
                            }}
                          >
                            {item.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </React.Fragment>
                  ))
                : overflowItems.map((item) => (
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
