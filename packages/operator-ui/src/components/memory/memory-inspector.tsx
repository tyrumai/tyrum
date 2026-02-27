import type { OperatorCore } from "@tyrum/operator-core";
import type {
  MemoryItem,
  MemoryItemFilter,
  MemoryItemPatch,
  MemoryProvenance,
  MemorySearchHit,
} from "@tyrum/client";
import { useEffect, useRef, useState } from "react";
import { getDesktopApi } from "../../desktop-api.js";
import { useOperatorStore } from "../../use-operator-store.js";

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

  return (
    <div data-testid="memory-inspector">
      <div data-testid="memory-browse-controls">
        <button
          type="button"
          data-testid="memory-mode-list"
          onClick={() => {
            setBrowseMode("list");
          }}
        >
          List
        </button>
        <button
          type="button"
          data-testid="memory-mode-search"
          onClick={() => {
            setBrowseMode("search");
          }}
        >
          Search
        </button>

        {browseMode === "search" ? (
          <input
            data-testid="memory-query"
            value={query}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
            }}
          />
        ) : null}

        <div data-testid="memory-filters">
          <div>
            {MEMORY_KINDS.map((kind) => (
              <label key={kind}>
                <input
                  type="checkbox"
                  data-testid={`memory-filter-kind-${kind}`}
                  checked={kinds.has(kind)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
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
                {kind}
              </label>
            ))}
          </div>

          <div>
            <input
              data-testid="memory-filter-tags"
              value={tags}
              onInput={(event) => {
                setTags(event.currentTarget.value);
              }}
              placeholder="tags (comma-separated)"
            />
          </div>

          <div>
            {MEMORY_SENSITIVITIES.map((sensitivity) => (
              <label key={sensitivity}>
                <input
                  type="checkbox"
                  data-testid={`memory-filter-sensitivity-${sensitivity}`}
                  checked={sensitivities.has(sensitivity)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
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
                {sensitivity}
              </label>
            ))}
          </div>

          <div>
            {MEMORY_PROVENANCE_SOURCE_KINDS.map((sourceKind) => (
              <label key={sourceKind}>
                <input
                  type="checkbox"
                  data-testid={`memory-filter-provenance-source-${sourceKind}`}
                  checked={provenanceSourceKinds.has(sourceKind)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
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
                {sourceKind}
              </label>
            ))}
          </div>

          <div>
            <input
              data-testid="memory-filter-provenance-channels"
              value={provenanceChannels}
              onInput={(event) => {
                setProvenanceChannels(event.currentTarget.value);
              }}
              placeholder="channels (comma-separated)"
            />
          </div>
          <div>
            <input
              data-testid="memory-filter-provenance-thread-ids"
              value={provenanceThreadIds}
              onInput={(event) => {
                setProvenanceThreadIds(event.currentTarget.value);
              }}
              placeholder="thread ids (comma-separated)"
            />
          </div>
          <div>
            <input
              data-testid="memory-filter-provenance-session-ids"
              value={provenanceSessionIds}
              onInput={(event) => {
                setProvenanceSessionIds(event.currentTarget.value);
              }}
              placeholder="session ids (comma-separated)"
            />
          </div>
        </div>

        <button
          type="button"
          data-testid="memory-run"
          onClick={() => {
            runBrowse();
          }}
        >
          Run
        </button>
        {memory.browse.loading ? <div>Loading…</div> : null}
        {memory.browse.error ? (
          <div role="alert" data-testid="memory-browse-error">
            {memory.browse.error.message}
          </div>
        ) : null}
      </div>

      <div data-testid="memory-export-panel">
        <label>
          <input
            type="checkbox"
            checked={includeTombstones}
            onChange={(event) => {
              setIncludeTombstones(event.currentTarget.checked);
            }}
          />
          Include tombstones
        </label>
        <button
          type="button"
          data-testid="memory-export"
          disabled={memory.export.running}
          onClick={() => {
            setDownloadError(null);
            void core.memoryStore.export({ includeTombstones, filter });
          }}
        >
          Export
        </button>
        {memory.export.artifactId
          ? (() => {
              const api = getDesktopApi();
              const canDownloadDesktop =
                Boolean(api?.gateway.httpFetch) && Boolean(api?.gateway.getOperatorConnection);
              const url = `${core.httpBaseUrl.replace(/\/$/, "")}/memory/exports/${memory.export.artifactId}`;

              if (canDownloadDesktop) {
                return (
                  <button
                    type="button"
                    data-testid="memory-export-download"
                    disabled={downloadBusy}
                    onClick={() => {
                      void downloadExport(memory.export.artifactId!);
                    }}
                  >
                    Download {memory.export.artifactId}
                  </button>
                );
              }

              return (
                <a data-testid="memory-export-download" href={url}>
                  Download {memory.export.artifactId}
                </a>
              );
            })()
          : null}
        {downloadError ? (
          <div role="alert" data-testid="memory-export-download-error">
            {downloadError}
          </div>
        ) : null}
        {memory.export.error ? (
          <div role="alert" data-testid="memory-export-error">
            {memory.export.error.message}
          </div>
        ) : null}
      </div>
      <div>
        {browseRows.map((row) => (
          <button
            key={row.memoryItemId}
            type="button"
            data-testid={`memory-item-${row.memoryItemId}`}
            onClick={() => {
              void core.memoryStore.inspect(row.memoryItemId);
            }}
          >
            <div>{row.memoryItemId}</div>
            <div data-testid={`memory-item-snippet-${row.memoryItemId}`}>{row.snippet}</div>
            <div data-testid={`memory-item-provenance-${row.memoryItemId}`}>{row.provenance}</div>
          </button>
        ))}
      </div>
      <div data-testid="memory-detail">
        {memory.inspect.loading ? <div>Loading…</div> : null}
        {memory.inspect.error ? (
          <div role="alert" data-testid="memory-inspect-error">
            {memory.inspect.error.message}
          </div>
        ) : null}
        {memory.inspect.item ? (
          <>
            <div>{memory.inspect.item.kind}</div>
            <div>{memory.inspect.item.memory_item_id}</div>
            {memory.inspect.item.kind === "fact" ? (
              <>
                <div data-testid="memory-detail-fact-key">{memory.inspect.item.key}</div>
                <pre data-testid="memory-detail-fact-value">
                  {stringifyJson(memory.inspect.item.value)}
                </pre>
              </>
            ) : null}
            <input
              data-testid="memory-edit-tags"
              value={tagsDraft}
              onInput={(event) => {
                setTagsDraft(event.currentTarget.value);
              }}
            />
            <select
              data-testid="memory-edit-sensitivity"
              value={sensitivityDraft}
              onChange={(event) => {
                setSensitivityDraft(event.currentTarget.value as MemorySensitivity);
              }}
            >
              {MEMORY_SENSITIVITIES.map((sensitivity) => (
                <option key={sensitivity} value={sensitivity}>
                  {sensitivity}
                </option>
              ))}
            </select>
            {memory.inspect.item.kind === "note" || memory.inspect.item.kind === "procedure" ? (
              <textarea
                data-testid="memory-edit-body"
                value={bodyMdDraft}
                disabled={saving}
                onInput={(event) => {
                  setBodyMdDraft(event.currentTarget.value);
                }}
              />
            ) : null}
            {memory.inspect.item.kind === "episode" ? (
              <textarea
                data-testid="memory-edit-summary"
                value={summaryMdDraft}
                disabled={saving}
                onInput={(event) => {
                  setSummaryMdDraft(event.currentTarget.value);
                }}
              />
            ) : null}
            <button
              type="button"
              data-testid="memory-save"
              disabled={saving}
              onClick={() => {
                void save();
              }}
            >
              Save
            </button>
            {saveError ? (
              <div role="alert" data-testid="memory-save-error">
                {saveError}
              </div>
            ) : null}
            <button
              type="button"
              data-testid="memory-forget"
              onClick={() => {
                const item = memory.inspect.item;
                if (!item) return;
                setForgetOpen(true);
                setForgetError(null);
                setForgetConfirm("");
                setForgetTargetId(item.memory_item_id);
              }}
            >
              Forget
            </button>
            {forgetOpen ? (
              <div data-testid="memory-forget-dialog">
                <div data-testid="memory-forget-target">{forgetTargetId}</div>
                <div>Type FORGET to confirm</div>
                <input
                  data-testid="memory-forget-confirm"
                  value={forgetConfirm}
                  onInput={(event) => {
                    setForgetConfirm(event.currentTarget.value);
                  }}
                />
                <button
                  type="button"
                  data-testid="memory-forget-submit"
                  disabled={forgetBusy || forgetConfirm !== "FORGET"}
                  onClick={() => {
                    void forget();
                  }}
                >
                  Confirm forget
                </button>
                <button
                  type="button"
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
                </button>
                {forgetError ? <div role="alert">{forgetError}</div> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {memory.tombstones.tombstones.length > 0 ? (
        <div data-testid="memory-tombstones">
          <div>tombstones</div>
          {memory.tombstones.tombstones.map((tombstone) => (
            <div key={tombstone.memory_item_id}>
              tombstone {tombstone.memory_item_id} {tombstone.deleted_by}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
