import type {
  MemoryDeletedBy,
  MemoryItem,
  MemoryItemKind,
  MemoryProvenance,
  MemoryProvenanceSourceKind,
  MemorySensitivity,
  MemoryTombstone,
} from "@tyrum/contracts";

export type MemoryProvenanceFilter = {
  source_kinds?: MemoryProvenanceSourceKind[];
  channels?: string[];
  thread_ids?: string[];
  session_ids?: string[];
};

export type MemoryItemFilter = {
  kinds?: MemoryItemKind[];
  keys?: string[];
  tags?: string[];
  sensitivities?: MemorySensitivity[];
  provenance?: MemoryProvenanceFilter;
};

export type MemoryCreateInput =
  | {
      kind: "fact";
      key: string;
      value: unknown;
      observed_at: string;
      confidence: number;
      tags?: string[];
      sensitivity?: MemorySensitivity;
      provenance: MemoryProvenance;
    }
  | {
      kind: "note";
      body_md: string;
      title?: string;
      tags?: string[];
      sensitivity?: MemorySensitivity;
      provenance: MemoryProvenance;
    }
  | {
      kind: "procedure";
      body_md: string;
      title?: string;
      confidence?: number;
      tags?: string[];
      sensitivity?: MemorySensitivity;
      provenance: MemoryProvenance;
    }
  | {
      kind: "episode";
      summary_md: string;
      occurred_at: string;
      tags?: string[];
      sensitivity?: MemorySensitivity;
      provenance: MemoryProvenance;
    };

export type MemoryItemPatch = {
  tags?: string[];
  sensitivity?: MemorySensitivity;
  provenance?: MemoryProvenance;
  key?: string;
  value?: unknown;
  title?: string;
  body_md?: string;
  summary_md?: string;
  confidence?: number;
  observed_at?: string;
  occurred_at?: string;
};

export type MemoryProvenanceSelector = {
  source_kind?: MemoryProvenanceSourceKind;
  channel?: string;
  thread_id?: string;
  session_id?: string;
  message_id?: string;
  tool_call_id?: string;
};

export type MemoryForgetSelector =
  | {
      kind: "id";
      memory_item_id: string;
    }
  | {
      kind: "key";
      key: string;
      item_kind?: MemoryItemKind;
    }
  | {
      kind: "tag";
      tag: string;
    }
  | {
      kind: "provenance";
      provenance: MemoryProvenanceSelector;
    };

export type MemorySearchHit = {
  memory_item_id: string;
  kind: MemoryItemKind;
  score: number;
  snippet?: string;
  provenance?: MemoryProvenance;
};

export type MemorySearchInput = {
  v?: 1;
  agent_id?: string;
  query: string;
  filter?: MemoryItemFilter;
  limit?: number;
  cursor?: string;
};

export type MemorySearchResult = {
  v: 1;
  hits: MemorySearchHit[];
  next_cursor?: string;
};

export type MemoryForgetResult = {
  deleted_count: number;
  tombstones: MemoryTombstone[];
};

export type MemoryDeleteParams = {
  deleted_by: MemoryDeletedBy;
  reason?: string;
};

export type MemoryConsolidationResult = {
  ran: boolean;
  created_items: MemoryItem[];
  deleted_tombstones: MemoryTombstone[];
  dropped_derived_indexes: { deleted_vectors: number; deleted_links: number };
  before: {
    total: { items: number; chars: number };
    per_kind: Record<MemoryItemKind, { items: number; chars: number }>;
  };
  after: {
    total: { items: number; chars: number };
    per_kind: Record<MemoryItemKind, { items: number; chars: number }>;
  };
};
