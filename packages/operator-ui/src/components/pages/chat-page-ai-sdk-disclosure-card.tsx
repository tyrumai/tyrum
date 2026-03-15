import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function useAutoDisclosure(isActive: boolean): {
  open: boolean;
  toggleOpen: () => void;
} {
  const [open, setOpen] = useState(isActive);
  const previousActiveRef = useRef(isActive);

  useEffect(() => {
    const previousActive = previousActiveRef.current;
    if (!previousActive && isActive) {
      setOpen(true);
    } else if (previousActive && !isActive) {
      setOpen(false);
    }
    previousActiveRef.current = isActive;
  }, [isActive]);

  return {
    open,
    toggleOpen: () => {
      setOpen((current) => !current);
    },
  };
}

export function DisclosureCard({
  children,
  header,
  open,
  onToggle,
}: {
  children: React.ReactNode;
  header: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-subtle/40">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-2 py-1.5 text-left"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="truncate text-sm font-medium text-fg">{header}</span>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-fg-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-fg-muted" />
        )}
      </button>
      {open ? <div className="border-t border-border/70 px-2 py-1.5">{children}</div> : null}
    </div>
  );
}
