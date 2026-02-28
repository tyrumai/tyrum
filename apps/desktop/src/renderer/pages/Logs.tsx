import { useEffect, useRef, useState } from "react";
import { Button, ScrollArea, Tabs, TabsList, TabsTrigger } from "@tyrum/operator-ui";

type LogTab = "gateway" | "node";

interface LogEntry {
  id: number;
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

const MAX_ENTRIES = 500;
let nextId = 0;

const LEVEL_CLASS_NAMES: Record<string, string> = {
  info: "text-primary",
  warn: "text-warning",
  error: "text-error",
  debug: "text-fg-muted",
};

export function LogsContent() {
  const [tab, setTab] = useState<LogTab>("gateway");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  useEffect(() => {
    const api = window.tyrumDesktop;
    if (!api) return;

    const unsubscribe = api.onLog((raw) => {
      const e = raw as { timestamp?: string; level?: string; source?: string; message?: string };
      const entry: LogEntry = {
        id: nextId++,
        timestamp: e.timestamp ?? new Date().toISOString(),
        level: e.level ?? "info",
        source: e.source ?? "gateway",
        message: e.message ?? String(raw),
      };
      setEntries((prev) => {
        const next = [...prev, entry];
        if (next.length > MAX_ENTRIES) {
          return next.slice(next.length - MAX_ENTRIES);
        }
        return next;
      });
    });
    return unsubscribe;
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    const viewport = scrollRootRef.current?.querySelector<HTMLElement>(
      '[data-scroll-area-viewport=""]',
    );
    if (!autoScroll.current || !viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [entries]);

  const handleScroll = () => {
    const viewport = scrollRootRef.current?.querySelector<HTMLElement>(
      '[data-scroll-area-viewport=""]',
    );
    if (!viewport) return;
    const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 40;
    autoScroll.current = atBottom;
  };

  const filtered = entries.filter((e) => e.source === tab);

  const clearLogs = () => setEntries([]);

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-4">
        <Tabs value={tab} onValueChange={(value) => setTab(value as LogTab)}>
          <TabsList>
            <TabsTrigger value="gateway">Gateway</TabsTrigger>
            <TabsTrigger value="node">Node</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="secondary" size="sm" onClick={clearLogs} className="ml-auto">
          Clear
        </Button>
      </div>

      <ScrollArea
        ref={scrollRootRef}
        className="min-h-[400px] max-h-[calc(100vh-300px)] rounded-lg border border-border bg-bg-subtle"
        onScroll={handleScroll}
      >
        <div className="p-3 font-mono text-xs leading-relaxed text-fg">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-fg-muted">No log entries yet</div>
          ) : (
            filtered.map((entry) => {
              const levelClassName = LEVEL_CLASS_NAMES[entry.level] ?? "text-fg";
              return (
                <div key={entry.id} className="whitespace-pre-wrap break-all py-0.5">
                  <span className="mr-2 text-fg-muted">{formatTime(entry.timestamp)}</span>
                  <span
                    className={["mr-2 inline-block w-12 font-bold uppercase", levelClassName].join(
                      " ",
                    )}
                  >
                    {entry.level}
                  </span>
                  <span className={levelClassName}>{entry.message}</span>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
