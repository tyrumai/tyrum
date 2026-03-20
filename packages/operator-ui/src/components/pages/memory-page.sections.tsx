import type {
  AgentListItem,
  MemoryItem,
  MemoryItemKind,
  MemorySensitivity,
  MemoryTombstone,
} from "@tyrum/contracts";
import { Search, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DataTableColumn } from "../ui/data-table.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { JsonViewer } from "../ui/json-viewer.js";
import {
  formatRelativeTime,
  memoryDeletedByLabel,
  memoryItemSummary,
  memoryKindBadgeVariant,
  memoryKindLabel,
  memorySensitivityBadgeVariant,
} from "./memory-page.lib.js";

const ALL_KINDS: MemoryItemKind[] = ["fact", "note", "procedure", "episode"];
const ALL_SENSITIVITIES: MemorySensitivity[] = ["public", "private", "sensitive"];

export function MemoryKindBadge({ kind }: { kind: MemoryItemKind }) {
  return <Badge variant={memoryKindBadgeVariant(kind)}>{memoryKindLabel(kind)}</Badge>;
}

export function MemorySensitivityBadge({ sensitivity }: { sensitivity: MemorySensitivity }) {
  return <Badge variant={memorySensitivityBadgeVariant(sensitivity)}>{sensitivity}</Badge>;
}

export function MemoryFilterBar({
  agents,
  agentId,
  onAgentChange,
  kinds,
  onKindsChange,
  sensitivity,
  onSensitivityChange,
  searchQuery,
  onSearchChange,
}: {
  agents: AgentListItem[];
  agentId: string | undefined;
  onAgentChange: (agentId: string | undefined) => void;
  kinds: MemoryItemKind[];
  onKindsChange: (kinds: MemoryItemKind[]) => void;
  sensitivity: MemorySensitivity | undefined;
  onSensitivityChange: (sensitivity: MemorySensitivity | undefined) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}) {
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  function handleSearchInput(value: string) {
    setLocalSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearchChange(value);
    }, 300);
  }

  function toggleKind(kind: MemoryItemKind) {
    if (kinds.includes(kind)) {
      onKindsChange(kinds.filter((k) => k !== kind));
    } else {
      onKindsChange([...kinds, kind]);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={agentId ?? ""}
          onChange={(e) => {
            onAgentChange(e.target.value || undefined);
          }}
          className="min-w-[160px]"
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.agent_id ?? a.agent_key} value={a.agent_id ?? ""}>
              {a.agent_key}
            </option>
          ))}
        </Select>

        <Select
          value={sensitivity ?? ""}
          onChange={(e) => {
            const val = e.target.value as MemorySensitivity | "";
            onSensitivityChange(val || undefined);
          }}
          className="min-w-[130px]"
        >
          <option value="">All sensitivities</option>
          {ALL_SENSITIVITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
          <Input
            placeholder="Search memory…"
            value={localSearch}
            onChange={(e) => {
              handleSearchInput(e.target.value);
            }}
            className="pl-8 pr-8"
          />
          {localSearch ? (
            <button
              type="button"
              onClick={() => {
                handleSearchInput("");
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ALL_KINDS.map((kind) => {
          const active = kinds.includes(kind);
          return (
            <Button
              key={kind}
              variant={active ? "primary" : "outline"}
              size="sm"
              onClick={() => {
                toggleKind(kind);
              }}
            >
              {memoryKindLabel(kind)}
            </Button>
          );
        })}
        {kinds.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onKindsChange([]);
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
      <span className="text-fg-muted font-medium">{label}</span>
      <span className="text-fg break-all">{children}</span>
    </div>
  );
}

export function MemoryItemExpandedDetail({
  item,
  agentLabel,
}: {
  item: MemoryItem;
  agentLabel?: string;
}) {
  return (
    <div className="grid gap-3 p-4 text-sm">
      <div className="grid gap-2">
        <DetailRow label="ID">{item.memory_item_id}</DetailRow>
        <DetailRow label="Kind">
          <MemoryKindBadge kind={item.kind} />
        </DetailRow>
        <DetailRow label="Agent">{agentLabel ?? item.agent_id}</DetailRow>
        <DetailRow label="Sensitivity">
          <MemorySensitivityBadge sensitivity={item.sensitivity} />
        </DetailRow>

        {item.kind === "fact" ? (
          <>
            <DetailRow label="Key">
              <code className="text-xs bg-bg-subtle rounded px-1 py-0.5">{item.key}</code>
            </DetailRow>
            <DetailRow label="Value">
              <JsonViewer value={item.value} defaultExpandedDepth={3} withCopyButton />
            </DetailRow>
            <DetailRow label="Observed at">{formatRelativeTime(item.observed_at)}</DetailRow>
            <DetailRow label="Confidence">{`${Math.round(item.confidence * 100)}%`}</DetailRow>
          </>
        ) : null}

        {item.kind === "note" ? (
          <>
            {item.title ? <DetailRow label="Title">{item.title}</DetailRow> : null}
            <DetailRow label="Body">
              <pre className="whitespace-pre-wrap text-xs bg-bg-subtle rounded p-2 max-h-60 overflow-auto">
                {item.body_md}
              </pre>
            </DetailRow>
          </>
        ) : null}

        {item.kind === "procedure" ? (
          <>
            {item.title ? <DetailRow label="Title">{item.title}</DetailRow> : null}
            <DetailRow label="Body">
              <pre className="whitespace-pre-wrap text-xs bg-bg-subtle rounded p-2 max-h-60 overflow-auto">
                {item.body_md}
              </pre>
            </DetailRow>
            {item.confidence !== undefined ? (
              <DetailRow label="Confidence">{`${Math.round(item.confidence * 100)}%`}</DetailRow>
            ) : null}
          </>
        ) : null}

        {item.kind === "episode" ? (
          <>
            <DetailRow label="Occurred at">{formatRelativeTime(item.occurred_at)}</DetailRow>
            <DetailRow label="Summary">
              <pre className="whitespace-pre-wrap text-xs bg-bg-subtle rounded p-2 max-h-60 overflow-auto">
                {item.summary_md}
              </pre>
            </DetailRow>
          </>
        ) : null}

        {item.tags.length > 0 ? (
          <DetailRow label="Tags">
            <div className="flex flex-wrap gap-1">
              {item.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          </DetailRow>
        ) : null}

        <DetailRow label="Source">{item.provenance.source_kind}</DetailRow>
        {item.provenance.channel ? (
          <DetailRow label="Channel">{item.provenance.channel}</DetailRow>
        ) : null}
        {item.provenance.session_id ? (
          <DetailRow label="Session">{item.provenance.session_id}</DetailRow>
        ) : null}
        {item.provenance.thread_id ? (
          <DetailRow label="Thread">{item.provenance.thread_id}</DetailRow>
        ) : null}

        <DetailRow label="Created">{formatRelativeTime(item.created_at)}</DetailRow>
        {item.updated_at ? (
          <DetailRow label="Updated">{formatRelativeTime(item.updated_at)}</DetailRow>
        ) : null}
      </div>
    </div>
  );
}

export function buildItemColumns(options: {
  agentLookup: Map<string, string>;
  canMutate: boolean;
  onDelete: (item: MemoryItem) => void;
}): DataTableColumn<MemoryItem>[] {
  const { agentLookup, canMutate, onDelete } = options;
  return [
    {
      id: "kind",
      header: "Kind",
      cell: (row) => <MemoryKindBadge kind={row.kind} />,
      sortValue: (row) => row.kind,
      headerClassName: "w-24",
    },
    {
      id: "summary",
      header: "Summary",
      cell: (row) => (
        <span className="text-sm text-fg truncate max-w-[400px] inline-block">
          {memoryItemSummary(row)}
        </span>
      ),
    },
    {
      id: "sensitivity",
      header: "Sensitivity",
      cell: (row) => <MemorySensitivityBadge sensitivity={row.sensitivity} />,
      sortValue: (row) => row.sensitivity,
      headerClassName: "w-28",
    },
    {
      id: "agent",
      header: "Agent",
      cell: (row) => (
        <span className="text-sm text-fg-muted">
          {agentLookup.get(row.agent_id) ?? row.agent_id.slice(0, 8)}
        </span>
      ),
      sortValue: (row) => agentLookup.get(row.agent_id) ?? row.agent_id,
      headerClassName: "w-28",
    },
    {
      id: "created_at",
      header: "Created",
      cell: (row) => (
        <span className="text-sm text-fg-muted">{formatRelativeTime(row.created_at)}</span>
      ),
      sortValue: (row) => row.created_at,
      headerClassName: "w-24",
    },
    {
      id: "actions",
      header: "",
      cell: (row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(row);
          }}
          title={canMutate ? "Delete memory item" : "Requires admin access"}
        >
          <Trash2 className="h-3.5 w-3.5 text-fg-muted" />
        </Button>
      ),
      headerClassName: "w-10",
    },
  ];
}

export function buildTombstoneColumns(
  agentLookup: Map<string, string>,
): DataTableColumn<MemoryTombstone>[] {
  return [
    {
      id: "memory_item_id",
      header: "Item ID",
      cell: (row) => (
        <code className="text-xs text-fg-muted">{row.memory_item_id.slice(0, 12)}…</code>
      ),
    },
    {
      id: "agent",
      header: "Agent",
      cell: (row) => (
        <span className="text-sm text-fg-muted">
          {agentLookup.get(row.agent_id) ?? row.agent_id.slice(0, 8)}
        </span>
      ),
      sortValue: (row) => agentLookup.get(row.agent_id) ?? row.agent_id,
    },
    {
      id: "deleted_by",
      header: "Deleted By",
      cell: (row) => <Badge variant="outline">{memoryDeletedByLabel(row.deleted_by)}</Badge>,
      sortValue: (row) => row.deleted_by,
    },
    {
      id: "reason",
      header: "Reason",
      cell: (row) => <span className="text-sm text-fg-muted">{row.reason ?? "—"}</span>,
    },
    {
      id: "deleted_at",
      header: "Deleted",
      cell: (row) => (
        <span className="text-sm text-fg-muted">{formatRelativeTime(row.deleted_at)}</span>
      ),
      sortValue: (row) => row.deleted_at,
    },
  ];
}
