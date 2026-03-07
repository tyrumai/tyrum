import type { OperatorCore } from "@tyrum/operator-core";
import type { MemoryItemPatch } from "@tyrum/client";
import { useEffect, useRef, useState } from "react";
import { getDesktopApi } from "../../desktop-api.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { MemoryBrowseControls } from "./memory-browse-controls.js";
import { MemoryDetailPanel } from "./memory-detail-panel.js";
import { MemoryExportPanel } from "./memory-export-panel.js";
import { MemoryForgetDialog } from "./memory-forget-dialog.js";
import {
  buildFilter,
  createBrowseRows,
  equalStringSet,
  parseCsvList,
  type MemoryKind,
  type MemoryProvenanceSourceKind,
  type MemorySensitivity,
} from "./memory-inspector.shared.js";
import { MemoryResultsList } from "./memory-results-list.js";
import { MemoryTombstones } from "./memory-tombstones.js";

export interface MemoryInspectorProps {
  core: OperatorCore;
  agentId?: string;
}

export function MemoryInspector({ core, agentId }: MemoryInspectorProps) {
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
    void core.memoryStore.list({ agentId, limit: 50 });
  }, [agentId, core]);

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
      await core.memoryStore.update(item.memory_item_id, patch, { agentId });
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
      await core.memoryStore.forget([{ kind: "id", memory_item_id: forgetTargetId }], { agentId });
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
      void core.memoryStore.search({ agentId, query: trimmedQuery, filter, limit: 50 });
      return;
    }
    void core.memoryStore.list({ agentId, filter, limit: 50 });
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

  const inspectedItem = memory.inspect.item;
  const browseRows = createBrowseRows(memory.browse.results);
  const resetForgetState = (): void => {
    setForgetOpen(false);
    setForgetTargetId(null);
    setForgetConfirm("");
    setForgetError(null);
  };

  return (
    <div data-testid="memory-inspector" className="grid gap-6">
      <MemoryBrowseControls
        browseMode={browseMode}
        setBrowseMode={setBrowseMode}
        query={query}
        setQuery={setQuery}
        filtersOpen={filtersOpen}
        setFiltersOpen={setFiltersOpen}
        kinds={kinds}
        setKinds={setKinds}
        sensitivities={sensitivities}
        setSensitivities={setSensitivities}
        tags={tags}
        setTags={setTags}
        provenanceSourceKinds={provenanceSourceKinds}
        setProvenanceSourceKinds={setProvenanceSourceKinds}
        provenanceChannels={provenanceChannels}
        setProvenanceChannels={setProvenanceChannels}
        provenanceThreadIds={provenanceThreadIds}
        setProvenanceThreadIds={setProvenanceThreadIds}
        provenanceSessionIds={provenanceSessionIds}
        setProvenanceSessionIds={setProvenanceSessionIds}
        browseLoading={memory.browse.loading}
        browseErrorMessage={memory.browse.error?.message ?? null}
        onRunBrowse={runBrowse}
      />

      <MemoryExportPanel
        httpBaseUrl={core.httpBaseUrl}
        includeTombstones={includeTombstones}
        onIncludeTombstonesChange={setIncludeTombstones}
        exportRunning={memory.export.running}
        exportArtifactId={memory.export.artifactId}
        exportErrorMessage={memory.export.error?.message ?? null}
        downloadBusy={downloadBusy}
        downloadError={downloadError}
        onExport={() => {
          setDownloadError(null);
          void core.memoryStore.export({ agentId, includeTombstones, filter });
        }}
        onDownload={(artifactId) => {
          void downloadExport(artifactId);
        }}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <MemoryResultsList
          browseRows={browseRows}
          browseLoading={memory.browse.loading}
          inspectedItemId={inspectedItem?.memory_item_id ?? null}
          onInspect={(memoryItemId) => {
            void core.memoryStore.inspect(memoryItemId, { agentId });
          }}
        />

        <MemoryDetailPanel
          item={inspectedItem}
          loading={memory.inspect.loading}
          errorMessage={memory.inspect.error?.message ?? null}
          tagsDraft={tagsDraft}
          onTagsDraftChange={setTagsDraft}
          sensitivityDraft={sensitivityDraft}
          onSensitivityDraftChange={setSensitivityDraft}
          bodyMdDraft={bodyMdDraft}
          onBodyMdDraftChange={setBodyMdDraft}
          summaryMdDraft={summaryMdDraft}
          onSummaryMdDraftChange={setSummaryMdDraft}
          saving={saving}
          saveError={saveError}
          onSave={() => {
            void save();
          }}
          onForget={() => {
            setForgetOpen(true);
            setForgetError(null);
            setForgetConfirm("");
            setForgetTargetId(inspectedItem!.memory_item_id);
          }}
        />
      </div>

      <MemoryForgetDialog
        open={forgetOpen}
        targetId={forgetTargetId}
        confirmValue={forgetConfirm}
        busy={forgetBusy}
        errorMessage={forgetError}
        onOpenChange={(open) => {
          if (!open) resetForgetState();
        }}
        onConfirmValueChange={setForgetConfirm}
        onCancel={resetForgetState}
        onConfirmForget={() => {
          void forget();
        }}
      />

      <MemoryTombstones tombstones={memory.tombstones.tombstones} />
    </div>
  );
}
