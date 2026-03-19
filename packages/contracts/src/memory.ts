import { z } from "zod";
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
// Built-in MCP memory tool arguments
// ---------------------------------------------------------------------------

const BuiltinMemoryTurnRef = z
  .object({
    agent_id: z.string().trim().min(1),
    workspace_id: z.string().trim().min(1).optional(),
    session_id: z.string().trim().min(1),
    channel: z.string().trim().min(1),
    thread_id: z.string().trim().min(1),
  })
  .partial()
  .strict();

export const BuiltinMemorySeedArgs = z
  .object({
    query: z.string().trim().min(1),
    turn: BuiltinMemoryTurnRef.optional(),
  })
  .strict();
export type BuiltinMemorySeedArgs = z.infer<typeof BuiltinMemorySeedArgs>;

export const BuiltinMemorySearchArgs = z
  .object({
    query: z.string().trim().min(1),
    kinds: z.array(MemoryItemKind).max(4).optional(),
    tags: z.array(z.string().trim().min(1)).max(20).optional(),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .strict();
export type BuiltinMemorySearchArgs = z.infer<typeof BuiltinMemorySearchArgs>;

const BuiltinMemoryWriteSensitivity = z.enum(["public", "private"]);

export const BuiltinMemoryWriteArgs = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("fact"),
      key: z.string().trim().min(1),
      value: z.unknown(),
      confidence: z.number().min(0).max(1).optional(),
      observed_at: z.string().trim().min(1).optional(),
      tags: z.array(z.string().trim().min(1)).max(20).optional(),
      sensitivity: BuiltinMemoryWriteSensitivity.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("note"),
      title: z.string().trim().min(1).optional(),
      body_md: z.string().trim().min(1),
      tags: z.array(z.string().trim().min(1)).max(20).optional(),
      sensitivity: BuiltinMemoryWriteSensitivity.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("procedure"),
      title: z.string().trim().min(1).optional(),
      body_md: z.string().trim().min(1),
      confidence: z.number().min(0).max(1).optional(),
      tags: z.array(z.string().trim().min(1)).max(20).optional(),
      sensitivity: BuiltinMemoryWriteSensitivity.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("episode"),
      summary_md: z.string().trim().min(1),
      occurred_at: z.string().trim().min(1).optional(),
      tags: z.array(z.string().trim().min(1)).max(20).optional(),
      sensitivity: BuiltinMemoryWriteSensitivity.optional(),
    })
    .strict(),
]);
export type BuiltinMemoryWriteArgs = z.infer<typeof BuiltinMemoryWriteArgs>;
