import { z } from "zod";
import { ArtifactId } from "../artifact.js";
import {
  MemoryCreateRequest,
  MemoryCreateResponse,
  MemoryDeleteRequest,
  MemoryDeleteResponse,
  MemoryExportRequest,
  MemoryExportResponse,
  MemoryForgetRequest,
  MemoryForgetResponse,
  MemoryGetRequest,
  MemoryGetResponse,
  MemoryItem,
  MemoryItemId,
  MemoryListRequest,
  MemoryListResponse,
  MemorySearchRequest,
  MemorySearchResponse,
  MemoryTombstone,
  MemoryUpdateRequest,
  MemoryUpdateResponse,
} from "../memory.js";
import {
  WsEventEnvelope,
  WsRequestEnvelope,
  WsResponseErrEnvelope,
  WsResponseOkEnvelope,
} from "./envelopes.js";

// ---------------------------------------------------------------------------
// Operation payloads (typed) — memory v1
// ---------------------------------------------------------------------------

export const WsMemorySearchPayload = MemorySearchRequest;
export type WsMemorySearchPayload = z.infer<typeof WsMemorySearchPayload>;

export const WsMemorySearchRequest = WsRequestEnvelope.extend({
  type: z.literal("memory.search"),
  payload: WsMemorySearchPayload,
});
export type WsMemorySearchRequest = z.infer<typeof WsMemorySearchRequest>;

export const WsMemoryListPayload = MemoryListRequest;
export type WsMemoryListPayload = z.infer<typeof WsMemoryListPayload>;

export const WsMemoryListRequest = WsRequestEnvelope.extend({
  type: z.literal("memory.list"),
  payload: WsMemoryListPayload,
});
export type WsMemoryListRequest = z.infer<typeof WsMemoryListRequest>;

export const WsMemoryGetPayload = MemoryGetRequest;
export type WsMemoryGetPayload = z.infer<typeof WsMemoryGetPayload>;

export const WsMemoryGetRequest = WsRequestEnvelope.extend({
  type: z.literal("memory.get"),
  payload: WsMemoryGetPayload,
});
export type WsMemoryGetRequest = z.infer<typeof WsMemoryGetRequest>;

export const WsMemoryCreatePayload = MemoryCreateRequest;
export type WsMemoryCreatePayload = z.infer<typeof WsMemoryCreatePayload>;

export const WsMemoryCreateRequest = WsRequestEnvelope.extend({
  type: z.literal("memory.create"),
  payload: WsMemoryCreatePayload,
});
export type WsMemoryCreateRequest = z.infer<typeof WsMemoryCreateRequest>;

export const WsMemoryUpdatePayload = MemoryUpdateRequest;
export type WsMemoryUpdatePayload = z.infer<typeof WsMemoryUpdatePayload>;

export const WsMemoryUpdateRequest = WsRequestEnvelope.extend({
  type: z.literal("memory.update"),
  payload: WsMemoryUpdatePayload,
});
export type WsMemoryUpdateRequest = z.infer<typeof WsMemoryUpdateRequest>;

export const WsMemoryDeletePayload = MemoryDeleteRequest;
export type WsMemoryDeletePayload = z.infer<typeof WsMemoryDeletePayload>;

export const WsMemoryDeleteRequest = WsRequestEnvelope.extend({
  type: z.literal("memory.delete"),
  payload: WsMemoryDeletePayload,
});
export type WsMemoryDeleteRequest = z.infer<typeof WsMemoryDeleteRequest>;

export const WsMemoryForgetPayload = MemoryForgetRequest;
export type WsMemoryForgetPayload = z.infer<typeof WsMemoryForgetPayload>;

export const WsMemoryForgetRequest = WsRequestEnvelope.extend({
  type: z.literal("memory.forget"),
  payload: WsMemoryForgetPayload,
});
export type WsMemoryForgetRequest = z.infer<typeof WsMemoryForgetRequest>;

export const WsMemoryExportPayload = MemoryExportRequest;
export type WsMemoryExportPayload = z.infer<typeof WsMemoryExportPayload>;

export const WsMemoryExportRequest = WsRequestEnvelope.extend({
  type: z.literal("memory.export"),
  payload: WsMemoryExportPayload,
});
export type WsMemoryExportRequest = z.infer<typeof WsMemoryExportRequest>;

// ---------------------------------------------------------------------------
// Operation responses (typed) — memory v1
// ---------------------------------------------------------------------------

export const WsMemorySearchResult = MemorySearchResponse;
export type WsMemorySearchResult = z.infer<typeof WsMemorySearchResult>;

export const WsMemorySearchResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("memory.search"),
  result: WsMemorySearchResult,
});
export type WsMemorySearchResponseOkEnvelope = z.infer<typeof WsMemorySearchResponseOkEnvelope>;

export const WsMemorySearchResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("memory.search"),
});
export type WsMemorySearchResponseErrEnvelope = z.infer<typeof WsMemorySearchResponseErrEnvelope>;

export const WsMemoryListResult = MemoryListResponse;
export type WsMemoryListResult = z.infer<typeof WsMemoryListResult>;

export const WsMemoryListResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("memory.list"),
  result: WsMemoryListResult,
});
export type WsMemoryListResponseOkEnvelope = z.infer<typeof WsMemoryListResponseOkEnvelope>;

export const WsMemoryListResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("memory.list"),
});
export type WsMemoryListResponseErrEnvelope = z.infer<typeof WsMemoryListResponseErrEnvelope>;

export const WsMemoryGetResult = MemoryGetResponse;
export type WsMemoryGetResult = z.infer<typeof WsMemoryGetResult>;

export const WsMemoryGetResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("memory.get"),
  result: WsMemoryGetResult,
});
export type WsMemoryGetResponseOkEnvelope = z.infer<typeof WsMemoryGetResponseOkEnvelope>;

export const WsMemoryGetResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("memory.get"),
});
export type WsMemoryGetResponseErrEnvelope = z.infer<typeof WsMemoryGetResponseErrEnvelope>;

export const WsMemoryCreateResult = MemoryCreateResponse;
export type WsMemoryCreateResult = z.infer<typeof WsMemoryCreateResult>;

export const WsMemoryCreateResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("memory.create"),
  result: WsMemoryCreateResult,
});
export type WsMemoryCreateResponseOkEnvelope = z.infer<typeof WsMemoryCreateResponseOkEnvelope>;

export const WsMemoryCreateResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("memory.create"),
});
export type WsMemoryCreateResponseErrEnvelope = z.infer<typeof WsMemoryCreateResponseErrEnvelope>;

export const WsMemoryUpdateResult = MemoryUpdateResponse;
export type WsMemoryUpdateResult = z.infer<typeof WsMemoryUpdateResult>;

export const WsMemoryUpdateResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("memory.update"),
  result: WsMemoryUpdateResult,
});
export type WsMemoryUpdateResponseOkEnvelope = z.infer<typeof WsMemoryUpdateResponseOkEnvelope>;

export const WsMemoryUpdateResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("memory.update"),
});
export type WsMemoryUpdateResponseErrEnvelope = z.infer<typeof WsMemoryUpdateResponseErrEnvelope>;

export const WsMemoryDeleteResult = MemoryDeleteResponse;
export type WsMemoryDeleteResult = z.infer<typeof WsMemoryDeleteResult>;

export const WsMemoryDeleteResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("memory.delete"),
  result: WsMemoryDeleteResult,
});
export type WsMemoryDeleteResponseOkEnvelope = z.infer<typeof WsMemoryDeleteResponseOkEnvelope>;

export const WsMemoryDeleteResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("memory.delete"),
});
export type WsMemoryDeleteResponseErrEnvelope = z.infer<typeof WsMemoryDeleteResponseErrEnvelope>;

export const WsMemoryForgetResult = MemoryForgetResponse;
export type WsMemoryForgetResult = z.infer<typeof WsMemoryForgetResult>;

export const WsMemoryForgetResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("memory.forget"),
  result: WsMemoryForgetResult,
});
export type WsMemoryForgetResponseOkEnvelope = z.infer<typeof WsMemoryForgetResponseOkEnvelope>;

export const WsMemoryForgetResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("memory.forget"),
});
export type WsMemoryForgetResponseErrEnvelope = z.infer<typeof WsMemoryForgetResponseErrEnvelope>;

export const WsMemoryExportResult = MemoryExportResponse;
export type WsMemoryExportResult = z.infer<typeof WsMemoryExportResult>;

export const WsMemoryExportResponseOkEnvelope = WsResponseOkEnvelope.extend({
  type: z.literal("memory.export"),
  result: WsMemoryExportResult,
});
export type WsMemoryExportResponseOkEnvelope = z.infer<typeof WsMemoryExportResponseOkEnvelope>;

export const WsMemoryExportResponseErrEnvelope = WsResponseErrEnvelope.extend({
  type: z.literal("memory.export"),
});
export type WsMemoryExportResponseErrEnvelope = z.infer<typeof WsMemoryExportResponseErrEnvelope>;

// ---------------------------------------------------------------------------
// Events (typed) — memory v1
// ---------------------------------------------------------------------------

export const WsMemoryItemEventPayload = z
  .object({
    item: MemoryItem,
  })
  .strict();
export type WsMemoryItemEventPayload = z.infer<typeof WsMemoryItemEventPayload>;

export const WsMemoryTombstoneEventPayload = z
  .object({
    tombstone: MemoryTombstone,
  })
  .strict();
export type WsMemoryTombstoneEventPayload = z.infer<typeof WsMemoryTombstoneEventPayload>;

export const WsMemoryConsolidatedEventPayload = z
  .object({
    from_memory_item_ids: z.array(MemoryItemId).min(1),
    item: MemoryItem,
  })
  .strict();
export type WsMemoryConsolidatedEventPayload = z.infer<typeof WsMemoryConsolidatedEventPayload>;

export const WsMemoryItemCreatedEvent = WsEventEnvelope.extend({
  type: z.literal("memory.item.created"),
  payload: WsMemoryItemEventPayload,
});
export type WsMemoryItemCreatedEvent = z.infer<typeof WsMemoryItemCreatedEvent>;

export const WsMemoryItemUpdatedEvent = WsEventEnvelope.extend({
  type: z.literal("memory.item.updated"),
  payload: WsMemoryItemEventPayload,
});
export type WsMemoryItemUpdatedEvent = z.infer<typeof WsMemoryItemUpdatedEvent>;

export const WsMemoryItemDeletedEvent = WsEventEnvelope.extend({
  type: z.literal("memory.item.deleted"),
  payload: WsMemoryTombstoneEventPayload,
});
export type WsMemoryItemDeletedEvent = z.infer<typeof WsMemoryItemDeletedEvent>;

export const WsMemoryItemForgottenEvent = WsEventEnvelope.extend({
  type: z.literal("memory.item.forgotten"),
  payload: WsMemoryTombstoneEventPayload,
});
export type WsMemoryItemForgottenEvent = z.infer<typeof WsMemoryItemForgottenEvent>;

export const WsMemoryItemConsolidatedEvent = WsEventEnvelope.extend({
  type: z.literal("memory.item.consolidated"),
  payload: WsMemoryConsolidatedEventPayload,
});
export type WsMemoryItemConsolidatedEvent = z.infer<typeof WsMemoryItemConsolidatedEvent>;

export const WsMemoryExportCompletedEventPayload = z
  .object({
    artifact_id: ArtifactId,
  })
  .strict();
export type WsMemoryExportCompletedEventPayload = z.infer<
  typeof WsMemoryExportCompletedEventPayload
>;

export const WsMemoryExportCompletedEvent = WsEventEnvelope.extend({
  type: z.literal("memory.export.completed"),
  payload: WsMemoryExportCompletedEventPayload,
});
export type WsMemoryExportCompletedEvent = z.infer<typeof WsMemoryExportCompletedEvent>;
