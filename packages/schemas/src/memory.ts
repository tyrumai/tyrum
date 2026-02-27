import { z } from "zod";
import { ArtifactId } from "./artifact.js";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { AgentId } from "./keys.js";

// ---------------------------------------------------------------------------
// Core primitives
// ---------------------------------------------------------------------------

export const MemoryItemId = UuidSchema;
export type MemoryItemId = z.infer<typeof MemoryItemId>;

export const MemoryItemKind = z.enum(["fact", "note", "procedure", "episode"]);
export type MemoryItemKind = z.infer<typeof MemoryItemKind>;

export const MemorySensitivity = z.enum(["public", "private", "sensitive"]);
export type MemorySensitivity = z.infer<typeof MemorySensitivity>;

export const MemoryProvenanceSourceKind = z.enum(["user", "operator", "tool", "system", "import"]);
export type MemoryProvenanceSourceKind = z.infer<typeof MemoryProvenanceSourceKind>;

export const MemoryProvenance = z
  .object({
    source_kind: MemoryProvenanceSourceKind,
    channel: z.string().trim().min(1).optional(),
    thread_id: z.string().trim().min(1).optional(),
    session_id: z.string().trim().min(1).optional(),
    message_id: z.string().trim().min(1).optional(),
    tool_call_id: z.string().trim().min(1).optional(),
    refs: z.array(z.string().trim().min(1)).default([]),
    metadata: z.unknown().optional(),
  })
  .strict();
export type MemoryProvenance = z.infer<typeof MemoryProvenance>;

export const MemoryItemBase = z
  .object({
    v: z.literal(1),
    memory_item_id: MemoryItemId,
    agent_id: AgentId,
    kind: MemoryItemKind,
    tags: z.array(z.string().trim().min(1)).default([]),
    sensitivity: MemorySensitivity.default("private"),
    provenance: MemoryProvenance,
    created_at: DateTimeSchema,
    updated_at: DateTimeSchema.optional(),
  })
  .strict();
export type MemoryItemBase = z.infer<typeof MemoryItemBase>;

export const MemoryFactItem = MemoryItemBase.extend({
  kind: z.literal("fact"),
  key: z.string().trim().min(1),
  value: z.unknown(),
  observed_at: DateTimeSchema,
  confidence: z.number().min(0).max(1),
}).strict();
export type MemoryFactItem = z.infer<typeof MemoryFactItem>;

export const MemoryNoteItem = MemoryItemBase.extend({
  kind: z.literal("note"),
  title: z.string().trim().min(1).optional(),
  body_md: z.string().trim().min(1),
}).strict();
export type MemoryNoteItem = z.infer<typeof MemoryNoteItem>;

export const MemoryProcedureItem = MemoryItemBase.extend({
  kind: z.literal("procedure"),
  title: z.string().trim().min(1).optional(),
  body_md: z.string().trim().min(1),
  confidence: z.number().min(0).max(1).optional(),
}).strict();
export type MemoryProcedureItem = z.infer<typeof MemoryProcedureItem>;

export const MemoryEpisodeItem = MemoryItemBase.extend({
  kind: z.literal("episode"),
  occurred_at: DateTimeSchema,
  summary_md: z.string().trim().min(1),
}).strict();
export type MemoryEpisodeItem = z.infer<typeof MemoryEpisodeItem>;

export const MemoryItem = z.discriminatedUnion("kind", [
  MemoryFactItem,
  MemoryNoteItem,
  MemoryProcedureItem,
  MemoryEpisodeItem,
]);
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---------------------------------------------------------------------------
// Tombstones (deletion proof)
// ---------------------------------------------------------------------------

export const MemoryDeletedBy = z.enum(["user", "operator", "system", "budget", "consolidation"]);
export type MemoryDeletedBy = z.infer<typeof MemoryDeletedBy>;

export const MemoryTombstone = z
  .object({
    v: z.literal(1),
    memory_item_id: MemoryItemId,
    agent_id: AgentId,
    deleted_at: DateTimeSchema,
    deleted_by: MemoryDeletedBy,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type MemoryTombstone = z.infer<typeof MemoryTombstone>;

// ---------------------------------------------------------------------------
// Search/query/filter
// ---------------------------------------------------------------------------

export const MemoryProvenanceFilter = z
  .object({
    source_kinds: z.array(MemoryProvenanceSourceKind).optional(),
    channels: z.array(z.string().trim().min(1)).optional(),
    thread_ids: z.array(z.string().trim().min(1)).optional(),
    session_ids: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();
export type MemoryProvenanceFilter = z.infer<typeof MemoryProvenanceFilter>;

export const MemoryItemFilter = z
  .object({
    kinds: z.array(MemoryItemKind).optional(),
    keys: z.array(z.string().trim().min(1)).optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    provenance: MemoryProvenanceFilter.optional(),
  })
  .strict();
export type MemoryItemFilter = z.infer<typeof MemoryItemFilter>;

export const MemorySearchRequest = z
  .object({
    v: z.literal(1),
    query: z.string().trim().min(1),
    filter: MemoryItemFilter.optional(),
    limit: z.number().int().positive().optional(),
    cursor: z.string().trim().min(1).optional(),
  })
  .strict();
export type MemorySearchRequest = z.infer<typeof MemorySearchRequest>;

export const MemorySearchHit = z
  .object({
    memory_item_id: MemoryItemId,
    kind: MemoryItemKind,
    score: z.number().min(0),
    snippet: z.string().trim().min(1).optional(),
  })
  .strict();
export type MemorySearchHit = z.infer<typeof MemorySearchHit>;

export const MemorySearchResponse = z
  .object({
    v: z.literal(1),
    hits: z.array(MemorySearchHit).default([]),
    next_cursor: z.string().trim().min(1).optional(),
  })
  .strict();
export type MemorySearchResponse = z.infer<typeof MemorySearchResponse>;

// ---------------------------------------------------------------------------
// CRUD requests/responses
// ---------------------------------------------------------------------------

export const MemoryGetRequest = z
  .object({
    v: z.literal(1),
    memory_item_id: MemoryItemId,
  })
  .strict();
export type MemoryGetRequest = z.infer<typeof MemoryGetRequest>;

export const MemoryGetResponse = z
  .object({
    v: z.literal(1),
    item: MemoryItem,
  })
  .strict();
export type MemoryGetResponse = z.infer<typeof MemoryGetResponse>;

export const MemoryListRequest = z
  .object({
    v: z.literal(1),
    filter: MemoryItemFilter.optional(),
    limit: z.number().int().positive().optional(),
    cursor: z.string().trim().min(1).optional(),
  })
  .strict();
export type MemoryListRequest = z.infer<typeof MemoryListRequest>;

export const MemoryListResponse = z
  .object({
    v: z.literal(1),
    items: z.array(MemoryItem).default([]),
    next_cursor: z.string().trim().min(1).optional(),
  })
  .strict();
export type MemoryListResponse = z.infer<typeof MemoryListResponse>;

export const MemoryItemCreateBase = z
  .object({
    kind: MemoryItemKind,
    tags: z.array(z.string().trim().min(1)).default([]),
    sensitivity: MemorySensitivity.default("private"),
    provenance: MemoryProvenance,
  })
  .strict();
export type MemoryItemCreateBase = z.infer<typeof MemoryItemCreateBase>;

export const MemoryFactCreateInput = MemoryItemCreateBase.extend({
  kind: z.literal("fact"),
  key: z.string().trim().min(1),
  value: z.unknown(),
  observed_at: DateTimeSchema,
  confidence: z.number().min(0).max(1),
}).strict();
export type MemoryFactCreateInput = z.infer<typeof MemoryFactCreateInput>;

export const MemoryNoteCreateInput = MemoryItemCreateBase.extend({
  kind: z.literal("note"),
  title: z.string().trim().min(1).optional(),
  body_md: z.string().trim().min(1),
}).strict();
export type MemoryNoteCreateInput = z.infer<typeof MemoryNoteCreateInput>;

export const MemoryProcedureCreateInput = MemoryItemCreateBase.extend({
  kind: z.literal("procedure"),
  title: z.string().trim().min(1).optional(),
  body_md: z.string().trim().min(1),
  confidence: z.number().min(0).max(1).optional(),
}).strict();
export type MemoryProcedureCreateInput = z.infer<typeof MemoryProcedureCreateInput>;

export const MemoryEpisodeCreateInput = MemoryItemCreateBase.extend({
  kind: z.literal("episode"),
  occurred_at: DateTimeSchema,
  summary_md: z.string().trim().min(1),
}).strict();
export type MemoryEpisodeCreateInput = z.infer<typeof MemoryEpisodeCreateInput>;

export const MemoryItemCreateInput = z.discriminatedUnion("kind", [
  MemoryFactCreateInput,
  MemoryNoteCreateInput,
  MemoryProcedureCreateInput,
  MemoryEpisodeCreateInput,
]);
export type MemoryItemCreateInput = z.infer<typeof MemoryItemCreateInput>;

export const MemoryCreateRequest = z
  .object({
    v: z.literal(1),
    item: MemoryItemCreateInput,
  })
  .strict();
export type MemoryCreateRequest = z.infer<typeof MemoryCreateRequest>;

export const MemoryCreateResponse = z
  .object({
    v: z.literal(1),
    item: MemoryItem,
  })
  .strict();
export type MemoryCreateResponse = z.infer<typeof MemoryCreateResponse>;

export const MemoryItemPatch = z
  .object({
    tags: z.array(z.string().trim().min(1)).optional(),
    sensitivity: MemorySensitivity.optional(),
    provenance: MemoryProvenance.optional(),
    key: z.string().trim().min(1).optional(),
    value: z.unknown().optional(),
    title: z.string().trim().min(1).optional(),
    body_md: z.string().trim().min(1).optional(),
    summary_md: z.string().trim().min(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
    observed_at: DateTimeSchema.optional(),
    occurred_at: DateTimeSchema.optional(),
  })
  .strict();
export type MemoryItemPatch = z.infer<typeof MemoryItemPatch>;

export const MemoryUpdateRequest = z
  .object({
    v: z.literal(1),
    memory_item_id: MemoryItemId,
    patch: MemoryItemPatch,
  })
  .strict();
export type MemoryUpdateRequest = z.infer<typeof MemoryUpdateRequest>;

export const MemoryUpdateResponse = z
  .object({
    v: z.literal(1),
    item: MemoryItem,
  })
  .strict();
export type MemoryUpdateResponse = z.infer<typeof MemoryUpdateResponse>;

export const MemoryDeleteRequest = z
  .object({
    v: z.literal(1),
    memory_item_id: MemoryItemId,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type MemoryDeleteRequest = z.infer<typeof MemoryDeleteRequest>;

export const MemoryDeleteResponse = z
  .object({
    v: z.literal(1),
    tombstone: MemoryTombstone,
  })
  .strict();
export type MemoryDeleteResponse = z.infer<typeof MemoryDeleteResponse>;

// ---------------------------------------------------------------------------
// Forget selectors
// ---------------------------------------------------------------------------

export const MemoryProvenanceSelector = z
  .object({
    source_kind: MemoryProvenanceSourceKind.optional(),
    channel: z.string().trim().min(1).optional(),
    thread_id: z.string().trim().min(1).optional(),
    session_id: z.string().trim().min(1).optional(),
    message_id: z.string().trim().min(1).optional(),
    tool_call_id: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine((selector) => Object.values(selector).some((value) => value !== undefined), {
    message: "provenance selector must include at least one field",
  });
export type MemoryProvenanceSelector = z.infer<typeof MemoryProvenanceSelector>;

export const MemoryForgetSelector = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("id"),
      memory_item_id: MemoryItemId,
    })
    .strict(),
  z
    .object({
      kind: z.literal("key"),
      key: z.string().trim().min(1),
      item_kind: MemoryItemKind.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tag"),
      tag: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("provenance"),
      provenance: MemoryProvenanceSelector,
    })
    .strict(),
]);
export type MemoryForgetSelector = z.infer<typeof MemoryForgetSelector>;

export const MemoryForgetRequest = z
  .object({
    v: z.literal(1),
    confirm: z.literal("FORGET"),
    selectors: z.array(MemoryForgetSelector).min(1),
  })
  .strict();
export type MemoryForgetRequest = z.infer<typeof MemoryForgetRequest>;

export const MemoryForgetResponse = z
  .object({
    v: z.literal(1),
    deleted_count: z.number().int().nonnegative(),
    tombstones: z.array(MemoryTombstone).default([]),
  })
  .strict();
export type MemoryForgetResponse = z.infer<typeof MemoryForgetResponse>;

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const MemoryExportRequest = z
  .object({
    v: z.literal(1),
    filter: MemoryItemFilter.optional(),
    include_tombstones: z.boolean().default(false),
  })
  .strict();
export type MemoryExportRequest = z.infer<typeof MemoryExportRequest>;

export const MemoryExportResponse = z
  .object({
    v: z.literal(1),
    artifact_id: ArtifactId,
  })
  .strict();
export type MemoryExportResponse = z.infer<typeof MemoryExportResponse>;

// ---------------------------------------------------------------------------
// Memory change events
// ---------------------------------------------------------------------------

export const MemoryChangeEventType = z.enum([
  "memory.item.created",
  "memory.item.updated",
  "memory.item.deleted",
  "memory.item.forgotten",
  "memory.item.consolidated",
]);
export type MemoryChangeEventType = z.infer<typeof MemoryChangeEventType>;

const MemoryItemEventPayload = z
  .object({
    item: MemoryItem,
  })
  .strict();

const MemoryTombstoneEventPayload = z
  .object({
    tombstone: MemoryTombstone,
  })
  .strict();

const MemoryConsolidatedEventPayload = z
  .object({
    from_memory_item_ids: z.array(MemoryItemId).min(1),
    item: MemoryItem,
  })
  .strict();

export const MemoryItemCreatedEvent = z
  .object({
    v: z.literal(1),
    type: z.literal("memory.item.created"),
    occurred_at: DateTimeSchema,
    agent_id: AgentId,
    payload: MemoryItemEventPayload,
  })
  .strict();
export type MemoryItemCreatedEvent = z.infer<typeof MemoryItemCreatedEvent>;

export const MemoryItemUpdatedEvent = z
  .object({
    v: z.literal(1),
    type: z.literal("memory.item.updated"),
    occurred_at: DateTimeSchema,
    agent_id: AgentId,
    payload: MemoryItemEventPayload,
  })
  .strict();
export type MemoryItemUpdatedEvent = z.infer<typeof MemoryItemUpdatedEvent>;

export const MemoryItemDeletedEvent = z
  .object({
    v: z.literal(1),
    type: z.literal("memory.item.deleted"),
    occurred_at: DateTimeSchema,
    agent_id: AgentId,
    payload: MemoryTombstoneEventPayload,
  })
  .strict();
export type MemoryItemDeletedEvent = z.infer<typeof MemoryItemDeletedEvent>;

export const MemoryItemForgottenEvent = z
  .object({
    v: z.literal(1),
    type: z.literal("memory.item.forgotten"),
    occurred_at: DateTimeSchema,
    agent_id: AgentId,
    payload: MemoryTombstoneEventPayload,
  })
  .strict();
export type MemoryItemForgottenEvent = z.infer<typeof MemoryItemForgottenEvent>;

export const MemoryItemConsolidatedEvent = z
  .object({
    v: z.literal(1),
    type: z.literal("memory.item.consolidated"),
    occurred_at: DateTimeSchema,
    agent_id: AgentId,
    payload: MemoryConsolidatedEventPayload,
  })
  .strict();
export type MemoryItemConsolidatedEvent = z.infer<typeof MemoryItemConsolidatedEvent>;

export const MemoryChangeEvent = z.discriminatedUnion("type", [
  MemoryItemCreatedEvent,
  MemoryItemUpdatedEvent,
  MemoryItemDeletedEvent,
  MemoryItemForgottenEvent,
  MemoryItemConsolidatedEvent,
]);
export type MemoryChangeEvent = z.infer<typeof MemoryChangeEvent>;
