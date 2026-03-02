import type { OperatorCore } from "@tyrum/operator-core";
import type {
  MemoryItem,
  MemoryItemFilter,
  MemoryItemPatch,
  MemoryProvenance,
  MemorySearchHit,
} from "@tyrum/client";
import { ChevronDown, Download, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.js";
import { getDesktopApi } from "../../desktop-api.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { Checkbox } from "../ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Spinner } from "../ui/spinner.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { Textarea } from "../ui/textarea.js";

const MEMORY_KINDS = ["fact", "note", "procedure", "episode"] as const;
type MemoryKind = (typeof MEMORY_KINDS)[number];

const MEMORY_SENSITIVITIES = ["public", "private", "sensitive"] as const;
type MemorySensitivity = (typeof MEMORY_SENSITIVITIES)[number];

const MEMORY_PROVENANCE_SOURCE_KINDS = ["user", "operator", "tool", "system", "import"] as const;
type MemoryProvenanceSourceKind = (typeof MEMORY_PROVENANCE_SOURCE_KINDS)[number];

function parseCsvList(raw: string): string[] {
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const deduped = new Set<string>();
  for (const value of values) {
    deduped.add(value);
  }
  return [...deduped.values()];
}

function buildFilter(input: {
  kinds: ReadonlySet<MemoryKind>;
  tags: string;
  sensitivities: ReadonlySet<MemorySensitivity>;
  provenanceSourceKinds: ReadonlySet<MemoryProvenanceSourceKind>;
  provenanceChannels: string;
  provenanceThreadIds: string;
  provenanceSessionIds: string;
}): MemoryItemFilter | undefined {
  const kinds = [...input.kinds.values()];
  const tags = parseCsvList(input.tags);
  const sensitivities = [...input.sensitivities.values()];
  const sourceKinds = [...input.provenanceSourceKinds.values()];
  const channels = parseCsvList(input.provenanceChannels);
  const threadIds = parseCsvList(input.provenanceThreadIds);
  const sessionIds = parseCsvList(input.provenanceSessionIds);

  const provenance =
    sourceKinds.length > 0 || channels.length > 0 || threadIds.length > 0 || sessionIds.length > 0
      ? {
          ...(sourceKinds.length > 0 ? { source_kinds: sourceKinds } : {}),
          ...(channels.length > 0 ? { channels } : {}),
          ...(threadIds.length > 0 ? { thread_ids: threadIds } : {}),
          ...(sessionIds.length > 0 ? { session_ids: sessionIds } : {}),
        }
      : undefined;

  if (kinds.length === 0 && tags.length === 0 && sensitivities.length === 0 && !provenance) {
    return undefined;
  }

  return {
    ...(kinds.length > 0 ? { kinds } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(sensitivities.length > 0 ? { sensitivities } : {}),
    ...(provenance ? { provenance } : {}),
  };
}

function shorten(text: string, max = 160): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function snippetForItem(item: MemoryItem): string {
  if (item.kind === "fact") {
    return shorten(`${item.key}: ${stringifyJson(item.value)}`);
  }
  if (item.kind === "episode") {
    return shorten(item.summary_md);
  }
  return shorten(item.body_md);
}

function snippetForHit(hit: MemorySearchHit): string {
  if (hit.snippet) return shorten(hit.snippet);
  return "";
}

function formatProvenance(provenance: MemoryProvenance | undefined): string {
  if (!provenance) return "";
  const parts: string[] = [provenance.source_kind];
  if (provenance.channel) parts.push(`channel:${provenance.channel}`);
  if (provenance.thread_id) parts.push(`thread:${provenance.thread_id}`);
  if (provenance.session_id) parts.push(`session:${provenance.session_id}`);
  return parts.join(" ");
}

function equalStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  if (setA.size !== a.length) return false;
  const setB = new Set(b);
  if (setB.size !== b.length) return false;
  for (const value of b) {
    if (!setA.has(value)) return false;
  }
  return true;
}

function CheckboxField({
  id,
  label,
  checked,
  onCheckedChange,
  "data-testid": testId,
}: {
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  "data-testid"?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        data-testid={testId ?? id}
        checked={checked}
        onCheckedChange={(value) => {
          onCheckedChange(value === true);
        }}
      />
      <Label htmlFor={id} className="cursor-pointer text-xs">
        {label}
      </Label>
    </div>
  );
}

/** Prevent Radix Dialog dismiss on outside click (pointerdown). */
function preventInteractOutside(e: Event): void {
  e.preventDefault();
}

export interface MemoryInspectorProps {
  core: OperatorCore;
}

export function MemoryInspector({ core }: MemoryInspectorProps) {
  const memory = useOperatorStore(core.memoryStore);
  const [bodyMdDraft, setBodyMdDraft] = useState("");
  const [summaryMdDraft, setSummaryMdDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [sensitivityDraft, setSensitivityDraft] = useState<MemorySensitivity>("private");
  const [forgetOpen, setForgetOpen] = useState(false);
  const [forgetTargetId, setForgetTargetId] = useState<string | null>(null);
  const [forgetConfirm, setForgetConfirm] = useState("");
  const [forgetBusy, setForgetBusy] = useState(false);
  const [forgetError, setForgetError] = useState<string | null>(null);
  const [includeTombstones, setIncludeTombstones] = useState(false);
  const [browseMode, setBrowseMode] = useState<"list" | "search">("list");
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<Set<MemoryKind>>(() => new Set());
  const [sensitivities, setSensitivities] = useState<Set<MemorySensitivity>>(() => new Set());
  const [tags, setTags] = useState("");
  const [provenanceSourceKinds, setProvenanceSourceKinds] = useState<
    Set<MemoryProvenanceSourceKind>
  >(() => new Set());
  const [provenanceChannels, setProvenanceChannels] = useState("");
  const [provenanceThreadIds, setProvenanceThreadIds] = useState("");
  const [provenanceSessionIds, setProvenanceSessionIds] = useState("");
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const lastSyncedDraftRef = useRef<{
    memoryItemId: string;
    bodyMdDraft: string;
    summaryMdDraft: string;
    tagsDraft: string;
    sensitivityDraft: MemorySensitivity;
  } | null>(null);

  useEffect(() => {
    void core.memoryStore.list({ limit: 50 });
  }, [core]);

  useEffect(() => {
    const item = memory.inspect.item;
    if (!item) {
      setSaveError(null);
      setBodyMdDraft("");
      setSummaryMdDraft("");
      setTagsDraft("");
      setSensitivityDraft("private");
      setForgetOpen(false);
      setForgetTargetId(null);
      setForgetConfirm("");
      setForgetError(null);
      lastSyncedDraftRef.current = null;
      return;
    }
    const nextDraft = {
      memoryItemId: item.memory_item_id,
      tagsDraft: item.tags.join(", "),
      sensitivityDraft: item.sensitivity,
      bodyMdDraft: item.kind === "note" || item.kind === "procedure" ? item.body_md : "",
      summaryMdDraft: item.kind === "episode" ? item.summary_md : "",
    };

    const prevDraft = lastSyncedDraftRef.current;
    if (!prevDraft || prevDraft.memoryItemId !== nextDraft.memoryItemId) {
      setSaveError(null);
      setBodyMdDraft(nextDraft.bodyMdDraft);
      setSummaryMdDraft(nextDraft.summaryMdDraft);
      setTagsDraft(nextDraft.tagsDraft);
      setSensitivityDraft(nextDraft.sensitivityDraft);
      lastSyncedDraftRef.current = nextDraft;
      return;
    }

    setBodyMdDraft((prev) => (prev === prevDraft.bodyMdDraft ? nextDraft.bodyMdDraft : prev));
    setSummaryMdDraft((prev) =>
      prev === prevDraft.summaryMdDraft ? nextDraft.summaryMdDraft : prev,
    );
    setTagsDraft((prev) => (prev === prevDraft.tagsDraft ? nextDraft.tagsDraft : prev));
    setSensitivityDraft((prev) =>
      prev === prevDraft.sensitivityDraft ? nextDraft.sensitivityDraft : prev,
    );
    lastSyncedDraftRef.current = nextDraft;
  }, [memory.inspect.item]);

  const save = async (): Promise<void> => {
    const item = memory.inspect.item;
    if (!item) return;
    if (saving) return;

    const patch: MemoryItemPatch = {};
    const nextTags = parseCsvList(tagsDraft);
    if (!equalStringSet(nextTags, item.tags)) {
      patch.tags = nextTags;
    }
    if (sensitivityDraft !== item.sensitivity) {
      patch.sensitivity = sensitivityDraft;
    }
    if ((item.kind === "note" || item.kind === "procedure") && bodyMdDraft !== item.body_md) {
      patch.body_md = bodyMdDraft;
    }
    if (item.kind === "episode" && summaryMdDraft !== item.summary_md) {
      patch.summary_md = summaryMdDraft;
    }
    if (Object.keys(patch).length === 0) return;

    setSaving(true);
    setSaveError(null);
    try {
      await core.memoryStore.update(item.memory_item_id, patch);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const forget = async (): Promise<void> => {
    if (!forgetTargetId) return;
    if (forgetBusy) return;
    if (forgetConfirm !== "FORGET") return;

    setForgetBusy(true);
    setForgetError(null);
    try {
      await core.memoryStore.forget([{ kind: "id", memory_item_id: forgetTargetId }]);
      setForgetOpen(false);
      setForgetTargetId(null);
      setForgetConfirm("");
    } catch (error) {
      setForgetError(error instanceof Error ? error.message : String(error));
    } finally {
      setForgetBusy(false);
    }
  };

  const filter = buildFilter({
    kinds,
    tags,
    sensitivities,
    provenanceSourceKinds,
    provenanceChannels,
    provenanceThreadIds,
    provenanceSessionIds,
  });

  const runBrowse = (): void => {
    if (browseMode === "search") {
      const trimmedQuery = query.trim();
      if (!trimmedQuery) return;
      void core.memoryStore.search({ query: trimmedQuery, filter, limit: 50 });
      return;
    }
    void core.memoryStore.list({ filter, limit: 50 });
  };

  const downloadExport = async (artifactId: string): Promise<void> => {
    if (downloadBusy) return;
    const api = getDesktopApi();
    const httpFetch = api?.gateway.httpFetch;
    const getOperatorConnection = api?.gateway.getOperatorConnection;
    if (!httpFetch || !getOperatorConnection) return;

    setDownloadBusy(true);
    setDownloadError(null);
    try {
      const connection = await getOperatorConnection();
      const token = connection.token.trim();
      if (!token) {
        throw new Error("Missing gateway token");
      }

      const url = `${core.httpBaseUrl.replace(/\/$/, "")}/memory/exports/${artifactId}`;
      const result = await httpFetch({
        url,
        init: { method: "GET", headers: { authorization: `Bearer ${token}` } },
      });
      if (result.status < 200 || result.status >= 300) {
        throw new Error(result.bodyText.trim() ? result.bodyText : `HTTP ${String(result.status)}`);
      }

      const contentType = result.headers["content-type"] ?? "application/octet-stream";
      const contentDisposition = result.headers["content-disposition"] ?? "";
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? `tyrum-memory-export-${artifactId}.json`;

      const objectUrl = URL.createObjectURL(new Blob([result.bodyText], { type: contentType }));
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloadBusy(false);
    }
  };

  type BrowseRow = { memoryItemId: string; snippet: string; provenance: string };
  const browseRows: BrowseRow[] = (() => {
    const results = memory.browse.results;
    if (!results) return [];
    if (results.kind === "list") {
      return results.items.map((item) => ({
        memoryItemId: item.memory_item_id,
        snippet: snippetForItem(item),
        provenance: formatProvenance(item.provenance),
      }));
    }
    return results.hits.map((hit) => ({
      memoryItemId: hit.memory_item_id,
      snippet: snippetForHit(hit),
      provenance: formatProvenance(hit.provenance),
    }));
  })();

  const inspectedItem = memory.inspect.item;

  return (
    <div data-testid="memory-inspector" className="grid gap-6">
      {/* Browse controls */}
      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div data-testid="memory-browse-controls" className="grid gap-4">
            <Tabs
              value={browseMode}
              onValueChange={(value) => {
                setBrowseMode(value as "list" | "search");
              }}
            >
              <TabsList>
                <TabsTrigger value="list" data-testid="memory-mode-list">
                  List
                </TabsTrigger>
                <TabsTrigger value="search" data-testid="memory-mode-search">
                  Search
                </TabsTrigger>
              </TabsList>

              <TabsContent value="list" />
              <TabsContent value="search">
                <Input
                  data-testid="memory-query"
                  placeholder="Search memories..."
                  value={query}
                  onChange={(event) => {
                    setQuery(event.currentTarget.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") runBrowse();
                  }}
                />
              </TabsContent>
            </Tabs>

            {/* Collapsible filters */}
            <div>
              <button
                type="button"
                className="flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg"
                onClick={() => {
                  setFiltersOpen((prev) => !prev);
                }}
              >
                <ChevronDown
                  className={cn("h-3 w-3 transition-transform", filtersOpen ? "" : "-rotate-90")}
                />
                Filters
              </button>

              {filtersOpen ? (
                <div data-testid="memory-filters" className="mt-3 grid gap-3">
                  <div>
                    <div className="mb-1.5 text-xs font-medium text-fg-muted">Kind</div>
                    <div className="flex flex-wrap gap-3">
                      {MEMORY_KINDS.map((kind) => (
                        <CheckboxField
                          key={kind}
                          id={`memory-filter-kind-${kind}`}
                          label={kind}
                          checked={kinds.has(kind)}
                          onCheckedChange={(checked) => {
                            setKinds((prev) => {
                              const next = new Set(prev);
                              if (checked) {
                                next.add(kind);
                              } else {
                                next.delete(kind);
                              }
                              return next;
                            });
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  <Input
                    data-testid="memory-filter-tags"
                    label="Tags"
                    value={tags}
                    onChange={(event) => {
                      setTags(event.currentTarget.value);
                    }}
                    placeholder="comma-separated"
                  />

                  <div>
                    <div className="mb-1.5 text-xs font-medium text-fg-muted">Sensitivity</div>
                    <div className="flex flex-wrap gap-3">
                      {MEMORY_SENSITIVITIES.map((sensitivity) => (
                        <CheckboxField
                          key={sensitivity}
                          id={`memory-filter-sensitivity-${sensitivity}`}
                          label={sensitivity}
                          checked={sensitivities.has(sensitivity)}
                          onCheckedChange={(checked) => {
                            setSensitivities((prev) => {
                              const next = new Set(prev);
                              if (checked) {
                                next.add(sensitivity);
                              } else {
                                next.delete(sensitivity);
                              }
                              return next;
                            });
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 text-xs font-medium text-fg-muted">Source</div>
                    <div className="flex flex-wrap gap-3">
                      {MEMORY_PROVENANCE_SOURCE_KINDS.map((sourceKind) => (
                        <CheckboxField
                          key={sourceKind}
                          id={`memory-filter-provenance-source-${sourceKind}`}
                          label={sourceKind}
                          checked={provenanceSourceKinds.has(sourceKind)}
                          onCheckedChange={(checked) => {
                            setProvenanceSourceKinds((prev) => {
                              const next = new Set(prev);
                              if (checked) {
                                next.add(sourceKind);
                              } else {
                                next.delete(sourceKind);
                              }
                              return next;
                            });
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <Input
                      data-testid="memory-filter-provenance-channels"
                      label="Channels"
                      value={provenanceChannels}
                      onChange={(event) => {
                        setProvenanceChannels(event.currentTarget.value);
                      }}
                      placeholder="comma-separated"
                    />
                    <Input
                      data-testid="memory-filter-provenance-thread-ids"
                      label="Thread IDs"
                      value={provenanceThreadIds}
                      onChange={(event) => {
                        setProvenanceThreadIds(event.currentTarget.value);
                      }}
                      placeholder="comma-separated"
                    />
                    <Input
                      data-testid="memory-filter-provenance-session-ids"
                      label="Session IDs"
                      value={provenanceSessionIds}
                      onChange={(event) => {
                        setProvenanceSessionIds(event.currentTarget.value);
                      }}
                      placeholder="comma-separated"
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-3">
              <Button
                size="sm"
                data-testid="memory-run"
                onClick={() => {
                  runBrowse();
                }}
                isLoading={memory.browse.loading}
              >
                <Search className="h-3.5 w-3.5" />
                {browseMode === "search" ? "Search" : "List"}
              </Button>

              {memory.browse.error ? (
                <span className="text-xs text-error" role="alert" data-testid="memory-browse-error">
                  {memory.browse.error.message}
                </span>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Export panel */}
      <div data-testid="memory-export-panel" className="flex flex-wrap items-center gap-3">
        <CheckboxField
          id="memory-include-tombstones"
          label="Include tombstones"
          checked={includeTombstones}
          onCheckedChange={setIncludeTombstones}
        />
        <Button
          size="sm"
          variant="secondary"
          data-testid="memory-export"
          disabled={memory.export.running}
          isLoading={memory.export.running}
          onClick={() => {
            setDownloadError(null);
            void core.memoryStore.export({ includeTombstones, filter });
          }}
        >
          Export
        </Button>
        {memory.export.artifactId
          ? (() => {
              const api = getDesktopApi();
              const canDownloadDesktop =
                Boolean(api?.gateway.httpFetch) && Boolean(api?.gateway.getOperatorConnection);
              const url = `${core.httpBaseUrl.replace(/\/$/, "")}/memory/exports/${memory.export.artifactId}`;

              if (canDownloadDesktop) {
                return (
                  <Button
                    size="sm"
                    variant="secondary"
                    data-testid="memory-export-download"
                    disabled={downloadBusy}
                    isLoading={downloadBusy}
                    onClick={() => {
                      void downloadExport(memory.export.artifactId!);
                    }}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </Button>
                );
              }

              return (
                <Button size="sm" variant="secondary" asChild>
                  <a data-testid="memory-export-download" href={url}>
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </a>
                </Button>
              );
            })()
          : null}
        {downloadError ? (
          <span
            className="text-xs text-error"
            role="alert"
            data-testid="memory-export-download-error"
          >
            {downloadError}
          </span>
        ) : null}
        {memory.export.error ? (
          <span className="text-xs text-error" role="alert" data-testid="memory-export-error">
            {memory.export.error.message}
          </span>
        ) : null}
      </div>

      {/* Browse results + detail side-by-side */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Results list */}
        <div className="grid gap-2">
          <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
            Results ({browseRows.length})
          </div>
          {browseRows.length === 0 && !memory.browse.loading ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-fg-muted">
                No memories found. Try adjusting your filters.
              </CardContent>
            </Card>
          ) : null}
          <div className="grid gap-1">
            {browseRows.map((row) => (
              <button
                key={row.memoryItemId}
                type="button"
                data-testid={`memory-item-${row.memoryItemId}`}
                className={cn(
                  "w-full rounded-md border-l-2 border-transparent px-3 py-2 text-left text-sm transition-colors",
                  "hover:bg-bg-subtle",
                  inspectedItem?.memory_item_id === row.memoryItemId
                    ? "border-primary bg-primary-dim"
                    : "",
                )}
                onClick={() => {
                  void core.memoryStore.inspect(row.memoryItemId);
                }}
              >
                <div className="truncate font-mono text-xs text-fg-muted">{row.memoryItemId}</div>
                <div
                  data-testid={`memory-item-snippet-${row.memoryItemId}`}
                  className="truncate text-fg"
                >
                  {row.snippet}
                </div>
                {row.provenance ? (
                  <div
                    data-testid={`memory-item-provenance-${row.memoryItemId}`}
                    className="truncate text-xs text-fg-muted"
                  >
                    {row.provenance}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {/* Detail panel */}
        <div data-testid="memory-detail">
          {memory.inspect.loading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-8">
                <Spinner className="h-5 w-5" />
              </CardContent>
            </Card>
          ) : null}
          {memory.inspect.error ? (
            <Alert
              variant="error"
              title="Error loading item"
              description={memory.inspect.error.message}
              data-testid="memory-inspect-error"
            />
          ) : null}
          {inspectedItem ? (
            <Card>
              <CardContent className="grid gap-4 pt-6">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{inspectedItem.kind}</Badge>
                  <span className="truncate font-mono text-xs text-fg-muted">
                    {inspectedItem.memory_item_id}
                  </span>
                </div>

                {inspectedItem.kind === "fact" ? (
                  <div className="grid gap-1">
                    <div className="text-xs font-medium text-fg-muted">Key</div>
                    <div
                      data-testid="memory-detail-fact-key"
                      className="text-sm font-medium text-fg"
                    >
                      {inspectedItem.key}
                    </div>
                    <pre
                      data-testid="memory-detail-fact-value"
                      className="mt-1 overflow-x-auto rounded-md bg-bg-subtle p-3 text-xs text-fg"
                    >
                      {stringifyJson(inspectedItem.value)}
                    </pre>
                  </div>
                ) : null}

                <Input
                  data-testid="memory-edit-tags"
                  label="Tags"
                  value={tagsDraft}
                  onChange={(event) => {
                    setTagsDraft(event.currentTarget.value);
                  }}
                  placeholder="comma-separated"
                />

                <div className="grid gap-2">
                  <Label htmlFor="memory-edit-sensitivity">Sensitivity</Label>
                  <select
                    id="memory-edit-sensitivity"
                    data-testid="memory-edit-sensitivity"
                    value={sensitivityDraft}
                    onChange={(event) => {
                      setSensitivityDraft(event.currentTarget.value as MemorySensitivity);
                    }}
                    className="flex h-9 w-full rounded-md border border-border bg-bg-card/40 px-3 py-1 text-sm text-fg shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                  >
                    {MEMORY_SENSITIVITIES.map((sensitivity) => (
                      <option key={sensitivity} value={sensitivity}>
                        {sensitivity}
                      </option>
                    ))}
                  </select>
                </div>

                {inspectedItem.kind === "note" || inspectedItem.kind === "procedure" ? (
                  <Textarea
                    data-testid="memory-edit-body"
                    label="Body"
                    value={bodyMdDraft}
                    disabled={saving}
                    onChange={(event) => {
                      setBodyMdDraft(event.currentTarget.value);
                    }}
                  />
                ) : null}

                {inspectedItem.kind === "episode" ? (
                  <Textarea
                    data-testid="memory-edit-summary"
                    label="Summary"
                    value={summaryMdDraft}
                    disabled={saving}
                    onChange={(event) => {
                      setSummaryMdDraft(event.currentTarget.value);
                    }}
                  />
                ) : null}

                {saveError ? (
                  <Alert
                    variant="error"
                    title="Save failed"
                    description={saveError}
                    data-testid="memory-save-error"
                  />
                ) : null}

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    data-testid="memory-save"
                    disabled={saving}
                    isLoading={saving}
                    onClick={() => {
                      void save();
                    }}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    data-testid="memory-forget"
                    onClick={() => {
                      setForgetOpen(true);
                      setForgetError(null);
                      setForgetConfirm("");
                      setForgetTargetId(inspectedItem.memory_item_id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Forget
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            !memory.inspect.loading &&
            !memory.inspect.error && (
              <Card>
                <CardContent className="py-8 text-center text-sm text-fg-muted">
                  Select a memory item to view details.
                </CardContent>
              </Card>
            )
          )}
        </div>
      </div>

      {/* Forget confirmation dialog */}
      <Dialog
        open={forgetOpen}
        onOpenChange={(open) => {
          if (!open) {
            setForgetOpen(false);
            setForgetTargetId(null);
            setForgetConfirm("");
            setForgetError(null);
          }
        }}
      >
        <DialogContent onInteractOutside={preventInteractOutside}>
          <DialogHeader>
            <DialogTitle>Forget memory item</DialogTitle>
            <DialogDescription>
              This will permanently delete{" "}
              <span data-testid="memory-forget-target" className="font-mono text-xs">
                {forgetTargetId}
              </span>
              . Type <strong>FORGET</strong> to confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4" data-testid="memory-forget-dialog">
            <Input
              data-testid="memory-forget-confirm"
              value={forgetConfirm}
              onChange={(event) => {
                setForgetConfirm(event.currentTarget.value);
              }}
              placeholder="Type FORGET"
            />
            {forgetError ? (
              <div className="mt-2 text-sm text-error" role="alert">
                {forgetError}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              size="sm"
              data-testid="memory-forget-cancel"
              disabled={forgetBusy}
              onClick={() => {
                setForgetOpen(false);
                setForgetTargetId(null);
                setForgetConfirm("");
                setForgetError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              data-testid="memory-forget-submit"
              disabled={forgetBusy || forgetConfirm !== "FORGET"}
              isLoading={forgetBusy}
              onClick={() => {
                void forget();
              }}
            >
              Confirm forget
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tombstones */}
      {memory.tombstones.tombstones.length > 0 ? (
        <div data-testid="memory-tombstones">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
            Tombstones
          </div>
          <div className="grid gap-1">
            {memory.tombstones.tombstones.map((tombstone) => (
              <div
                key={tombstone.memory_item_id}
                className="rounded-md bg-bg-subtle px-3 py-2 text-xs text-fg-muted"
              >
                <span className="font-mono">{tombstone.memory_item_id}</span>
                {tombstone.deleted_by ? (
                  <span className="ml-2">deleted by {tombstone.deleted_by}</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
