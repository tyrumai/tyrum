import type {
  MemoryItem,
  MemoryItemFilter,
  MemoryProvenance,
  MemorySearchHit,
} from "@tyrum/client";
import type { MemoryBrowseResults } from "@tyrum/operator-core";

export const MEMORY_KINDS = ["fact", "note", "procedure", "episode"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_SENSITIVITIES = ["public", "private", "sensitive"] as const;
export type MemorySensitivity = (typeof MEMORY_SENSITIVITIES)[number];

export const MEMORY_PROVENANCE_SOURCE_KINDS = [
  "user",
  "operator",
  "tool",
  "system",
  "import",
] as const;
export type MemoryProvenanceSourceKind = (typeof MEMORY_PROVENANCE_SOURCE_KINDS)[number];

export interface MemoryFilterInput {
  kinds: ReadonlySet<MemoryKind>;
  tags: string;
  sensitivities: ReadonlySet<MemorySensitivity>;
  provenanceSourceKinds: ReadonlySet<MemoryProvenanceSourceKind>;
  provenanceChannels: string;
  provenanceThreadIds: string;
  provenanceSessionIds: string;
}

export interface BrowseRow {
  memoryItemId: string;
  snippet: string;
  provenance: string;
}

export function parseCsvList(raw: string): string[] {
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

export function buildFilter(input: MemoryFilterInput): MemoryItemFilter | undefined {
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

export function stringifyJson(value: unknown): string {
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

export function createBrowseRows(results: MemoryBrowseResults | null): BrowseRow[] {
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
}

export function equalStringSet(a: string[], b: string[]): boolean {
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

export function updateSetSelection<T>(prev: Set<T>, value: T, checked: boolean): Set<T> {
  const next = new Set(prev);
  if (checked) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return next;
}
