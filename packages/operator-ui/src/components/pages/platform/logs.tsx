import { useEffect, useRef, useState } from "react";
import type { DesktopApi } from "../../../desktop-api.js";
import { useHostApi } from "../../../host/host-api.js";
import { Alert } from "../../ui/alert.js";
import { Button } from "../../ui/button.js";
import { ScrollArea } from "../../ui/scroll-area.js";
import { Tabs, TabsList, TabsTrigger } from "../../ui/tabs.js";

type LogTab = "gateway" | "node";
type DesktopLogApi = DesktopApi & { onLog: NonNullable<DesktopApi["onLog"]> };

interface LogEntry {
  id: number;
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

interface RawLogEntry {
  timestamp?: string;
  level?: string;
  source?: string;
  message?: string;
}

const MAX_ENTRIES = 500;
const LOG_VIEWPORT_SELECTOR = '[data-scroll-area-viewport=""]';

const LEVEL_CLASS_NAMES: Record<string, string> = {
  info: "text-primary",
  warn: "text-warning",
  error: "text-error",
  debug: "text-fg-muted",
};

export function PlatformLogsPanel() {
  const host = useHostApi();
  if (host.kind !== "desktop") {
    return (
      <Alert
        variant="warning"
        title="Not available"
        description="Logs are only available in the desktop app."
      />
    );
  }

  const api = host.api;
  if (!api) {
    return <Alert variant="error" title="Desktop API not available." />;
  }
  if (!api.onLog) {
    return (
      <Alert
        variant="warning"
        title="Logs unavailable"
        description="This desktop build does not expose log streaming."
      />
    );
  }

  return <DesktopLogsPanel api={api as DesktopLogApi} />;
}

function DesktopLogsPanel({ api }: { api: DesktopLogApi }) {
  const [tab, setTab] = useState<LogTab>("gateway");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);
  const nextIdRef = useRef(0);

  useEffect(() => {
    const unsubscribe = api.onLog((raw) => {
      const entry = createLogEntry(raw, nextIdRef.current++);
      setEntries((prev) => appendLogEntry(prev, entry));
    });
    return unsubscribe;
  }, [api]);

  useEffect(() => {
    const viewport = getLogViewport(scrollRootRef.current);
    if (!autoScroll.current || !viewport) {
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  }, [entries]);

  const handleScroll = () => {
    const viewport = getLogViewport(scrollRootRef.current);
    if (!viewport) {
      return;
    }
    autoScroll.current = isViewportAtBottom(viewport);
  };

  const filtered = entries.filter((e) => e.source === tab);

  return (
    <div className="grid gap-4">
      <LogsToolbar
        tab={tab}
        onTabChange={(value) => setTab(value as LogTab)}
        onClear={() => setEntries([])}
      />

      <ScrollArea
        ref={scrollRootRef}
        className="min-h-[400px] max-h-[calc(100vh-300px)] rounded-lg border border-border bg-bg-subtle"
        onScroll={handleScroll}
      >
        <LogEntryList entries={filtered} />
      </ScrollArea>
    </div>
  );
}

function LogsToolbar(props: {
  tab: LogTab;
  onTabChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-4">
      <Tabs value={props.tab} onValueChange={props.onTabChange}>
        <TabsList>
          <TabsTrigger value="gateway">Gateway</TabsTrigger>
          <TabsTrigger value="node">Node</TabsTrigger>
        </TabsList>
      </Tabs>
      <Button variant="secondary" size="sm" onClick={props.onClear} className="ml-auto">
        Clear
      </Button>
    </div>
  );
}

function LogEntryList({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="p-3 font-mono text-xs leading-relaxed text-fg">
        <div className="py-10 text-center text-sm text-fg-muted">No log entries yet</div>
      </div>
    );
  }

  return (
    <div className="p-3 font-mono text-xs leading-relaxed text-fg">
      {entries.map((entry) => {
        const levelClassName = LEVEL_CLASS_NAMES[entry.level] ?? "text-fg";
        return (
          <div key={entry.id} className="whitespace-pre-wrap break-all py-0.5">
            <span className="mr-2 text-fg-muted">{formatLogTime(entry.timestamp)}</span>
            <span
              className={["mr-2 inline-block w-12 font-bold uppercase", levelClassName].join(" ")}
            >
              {entry.level}
            </span>
            <span className={levelClassName}>{entry.message}</span>
          </div>
        );
      })}
    </div>
  );
}

function createLogEntry(raw: unknown, id: number): LogEntry {
  const entry = raw as RawLogEntry;
  return {
    id,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    level: entry.level ?? "info",
    source: entry.source ?? "gateway",
    message: entry.message ?? String(raw),
  };
}

function appendLogEntry(entries: LogEntry[], entry: LogEntry): LogEntry[] {
  const next = [...entries, entry];
  if (next.length <= MAX_ENTRIES) {
    return next;
  }
  return next.slice(next.length - MAX_ENTRIES);
}

function getLogViewport(root: HTMLDivElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>(LOG_VIEWPORT_SELECTOR) ?? null;
}

function isViewportAtBottom(viewport: HTMLElement): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 40;
}

function formatLogTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}
