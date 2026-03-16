import type {
  MemoryDeletedBy,
  MemoryItem,
  MemoryItemKind,
  MemoryProvenance,
  MemorySensitivity,
  MemoryTombstone,
} from "@tyrum/schemas";

export interface RawMemoryItemRow {
  memory_item_id: string;
  agent_id: string;
  kind: MemoryItemKind;
  sensitivity: MemorySensitivity;
  key: string | null;
  value_json: string | null;
  observed_at: string | null;
  title: string | null;
  body_md: string | null;
  occurred_at: string | null;
  summary_md: string | null;
  confidence: number | null;
  created_at: string | Date;
  updated_at: string | Date | null;
}

export interface RawProvenanceRow {
  memory_item_id: string;
  agent_id: string;
  source_kind: MemoryProvenance["source_kind"];
  channel: string | null;
  thread_id: string | null;
  session_id: string | null;
  message_id: string | null;
  tool_call_id: string | null;
  refs_json: string;
  metadata_json: string | null;
}

export interface RawTagRow {
  tag: string;
}

export interface RawTombstoneRow {
  memory_item_id: string;
  agent_id: string;
  deleted_at: string | Date;
  deleted_by: MemoryDeletedBy;
  reason: string | null;
}

export interface RawSearchRow {
  memory_item_id: string;
  kind: MemoryItemKind;
  key: string | null;
  title: string | null;
  body_md: string | null;
  summary_md: string | null;
  created_at: string | Date;
  source_kind: MemoryProvenance["source_kind"];
  channel: string | null;
  thread_id: string | null;
  session_id: string | null;
  message_id: string | null;
  tool_call_id: string | null;
  refs_json: string;
  metadata_json: string | null;
}

export type Cursor = { sort: string; id: string };

export type MemoryBudgetLimits = {
  max_total_items: number;
  max_total_chars: number;
  per_kind: Record<MemoryItemKind, { max_items: number; max_chars: number }>;
};

export type MemoryBudgetUsage = {
  total: { items: number; chars: number };
  per_kind: Record<MemoryItemKind, { items: number; chars: number }>;
};

export type MemoryConsolidationResult = {
  ran: boolean;
  created_items: MemoryItem[];
  deleted_tombstones: MemoryTombstone[];
  dropped_derived_indexes: { deleted_vectors: number; deleted_links: number };
  before: MemoryBudgetUsage;
  after: MemoryBudgetUsage;
};

export type RawBudgetRow = {
  memory_item_id: string;
  kind: MemoryItemKind;
  sensitivity: MemorySensitivity;
  key: string | null;
  value_json: string | null;
  observed_at: string | null;
  title: string | null;
  body_md: string | null;
  occurred_at: string | null;
  summary_md: string | null;
  confidence: number | null;
  created_at: string | Date;
  updated_at: string | Date | null;
};
