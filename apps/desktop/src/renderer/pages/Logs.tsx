import { useEffect, useRef, useState } from "react";
import { colors, fonts, heading, tabRow, tab as tabStyle } from "../theme.js";

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

const logContainerStyle: React.CSSProperties = {
  background: colors.bgSubtle,
  borderRadius: 8,
  padding: 12,
  minHeight: 400,
  maxHeight: "calc(100vh - 200px)",
  overflowY: "auto",
  fontFamily: fonts.mono,
  fontSize: 12,
  lineHeight: 1.6,
  border: `1px solid ${colors.border}`,
};

const LEVEL_COLORS: Record<string, string> = {
  info: "#60a5fa",
  warn: "#eab308",
  error: "#ef4444",
  debug: "#9ca3af",
};

function entryStyle(level: string): React.CSSProperties {
  return {
    color: LEVEL_COLORS[level] ?? colors.fg,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
    padding: "1px 0",
  };
}

const timestampStyle: React.CSSProperties = {
  color: colors.fgMuted,
  marginRight: 8,
};

const levelStyle = (level: string): React.CSSProperties => ({
  color: LEVEL_COLORS[level] ?? colors.fg,
  fontWeight: 700,
  marginRight: 8,
  textTransform: "uppercase" as const,
  minWidth: 44,
  display: "inline-block",
});

const emptyStyle: React.CSSProperties = {
  color: colors.fgMuted,
  textAlign: "center" as const,
  padding: 40,
  fontSize: 14,
};

const clearBtnStyle: React.CSSProperties = {
  padding: "6px 16px",
  borderRadius: 6,
  border: `1px solid ${colors.border}`,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  background: "transparent",
  color: colors.fg,
  marginLeft: "auto",
};

export function Logs() {
  const [tab, setTab] = useState<LogTab>("gateway");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
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
    if (autoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
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
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
        <h1 style={{ ...heading, marginBottom: 0 }}>Logs</h1>
        <button style={clearBtnStyle} onClick={clearLogs}>
          Clear
        </button>
      </div>

      <div style={tabRow}>
        <button
          style={tabStyle(tab === "gateway")}
          onClick={() => setTab("gateway")}
        >
          Gateway
        </button>
        <button
          style={tabStyle(tab === "node")}
          onClick={() => setTab("node")}
        >
          Node
        </button>
      </div>

      <div
        ref={scrollRef}
        style={logContainerStyle}
        onScroll={handleScroll}
      >
        {filtered.length === 0 ? (
          <div style={emptyStyle}>No log entries yet</div>
        ) : (
          filtered.map((entry) => (
            <div key={entry.id} style={entryStyle(entry.level)}>
              <span style={timestampStyle}>{formatTime(entry.timestamp)}</span>
              <span style={levelStyle(entry.level)}>
                {entry.level}
              </span>
              {entry.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
