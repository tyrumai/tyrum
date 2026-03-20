import {
  MemoryItemGetResponse,
  MemoryItemKind,
  MemoryItemListResponse,
  MemorySearchResponse,
  MemoryDeleteResponse,
  MemorySensitivity,
  MemoryTombstoneListResponse,
} from "@tyrum/contracts";
import { z } from "zod";
import {
  HttpTransport,
  NonEmptyString,
  validateOrThrow,
  type TyrumRequestOptions,
} from "./shared.js";

const MemoryListQuery = z
  .object({
    agent_id: z.string().trim().min(1).optional(),
    kinds: z.array(MemoryItemKind).optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    sensitivities: z.array(MemorySensitivity).optional(),
    limit: z.number().int().positive().max(500).optional(),
    cursor: z.string().trim().min(1).optional(),
  })
  .strict();

const MemorySearchQuery = z
  .object({
    agent_id: z.string().trim().min(1).optional(),
    query: z.string().trim().min(1),
    kinds: z.array(MemoryItemKind).optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    sensitivities: z.array(MemorySensitivity).optional(),
    limit: z.number().int().positive().max(100).optional(),
  })
  .strict();

const MemoryTombstoneListQuery = z
  .object({
    agent_id: z.string().trim().min(1).optional(),
    limit: z.number().int().positive().max(500).optional(),
    cursor: z.string().trim().min(1).optional(),
  })
  .strict();

const MemoryDeleteBody = z
  .object({
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

export type MemoryListInput = z.input<typeof MemoryListQuery>;
export type MemoryListResult = z.output<typeof MemoryItemListResponse>;
export type MemoryGetResult = z.output<typeof MemoryItemGetResponse>;
export type MemorySearchInput = z.input<typeof MemorySearchQuery>;
export type MemorySearchResult = z.output<typeof MemorySearchResponse>;
export type MemoryDeleteInput = z.input<typeof MemoryDeleteBody>;
export type MemoryDeleteResult = z.output<typeof MemoryDeleteResponse>;
export type MemoryTombstoneListInput = z.input<typeof MemoryTombstoneListQuery>;
export type MemoryTombstoneListResult = z.output<typeof MemoryTombstoneListResponse>;

export interface MemoryApi {
  list(query?: MemoryListInput, options?: TyrumRequestOptions): Promise<MemoryListResult>;
  getById(id: string, options?: TyrumRequestOptions): Promise<MemoryGetResult>;
  search(query: MemorySearchInput, options?: TyrumRequestOptions): Promise<MemorySearchResult>;
  delete(
    id: string,
    input?: MemoryDeleteInput,
    options?: TyrumRequestOptions,
  ): Promise<MemoryDeleteResult>;
  listTombstones(
    query?: MemoryTombstoneListInput,
    options?: TyrumRequestOptions,
  ): Promise<MemoryTombstoneListResult>;
}

export function createMemoryApi(transport: HttpTransport): MemoryApi {
  return {
    async list(query, options) {
      const parsedQuery = validateOrThrow(MemoryListQuery, query ?? {}, "memory list query");
      return await transport.request({
        method: "GET",
        path: "/memory/items",
        query: parsedQuery,
        response: MemoryItemListResponse,
        signal: options?.signal,
      });
    },

    async getById(id, options) {
      const parsedId = validateOrThrow(NonEmptyString, id, "memory item id");
      return await transport.request({
        method: "GET",
        path: `/memory/items/${encodeURIComponent(parsedId)}`,
        response: MemoryItemGetResponse,
        signal: options?.signal,
      });
    },

    async search(query, options) {
      const parsedQuery = validateOrThrow(MemorySearchQuery, query, "memory search query");
      return await transport.request({
        method: "GET",
        path: "/memory/search",
        query: parsedQuery,
        response: MemorySearchResponse,
        signal: options?.signal,
      });
    },

    async delete(id, input, options) {
      const parsedId = validateOrThrow(NonEmptyString, id, "memory item id");
      const body = validateOrThrow(MemoryDeleteBody, input ?? {}, "memory delete input");
      return await transport.request({
        method: "DELETE",
        path: `/memory/items/${encodeURIComponent(parsedId)}`,
        body,
        response: MemoryDeleteResponse,
        signal: options?.signal,
      });
    },

    async listTombstones(query, options) {
      const parsedQuery = validateOrThrow(
        MemoryTombstoneListQuery,
        query ?? {},
        "memory tombstone list query",
      );
      return await transport.request({
        method: "GET",
        path: "/memory/tombstones",
        query: parsedQuery,
        response: MemoryTombstoneListResponse,
        signal: options?.signal,
      });
    },
  };
}
