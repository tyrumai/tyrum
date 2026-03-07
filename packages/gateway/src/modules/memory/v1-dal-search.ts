import type {
  MemoryItemFilter,
  MemoryItemKind,
  MemoryProvenance,
  MemorySearchResponse,
} from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import type { MemorySearchInput, RawSearchRow } from "./v1-dal-types.js";
import {
  buildMemoryV1ItemQueryParts,
  buildSnippet,
  invalidRequestError,
  markdownToPlainText,
  normalizeTime,
  parseJson,
  uniqSortedStrings,
} from "./v1-dal-helpers.js";

type Scope = { tenantId: string; agentId: string };

const MAX_FILTER_KEYS = 50;
const MAX_FILTER_TAGS = 20;
const MAX_FILTER_PROVENANCE_VALUES = 20;

function normalizeSearchFilter(filter: MemoryItemFilter | undefined): MemoryItemFilter | undefined {
  if (!filter) return undefined;

  const next: MemoryItemFilter = {};
  if (filter.kinds && filter.kinds.length > 0) next.kinds = [...new Set(filter.kinds)];
  if (filter.sensitivities && filter.sensitivities.length > 0) {
    next.sensitivities = [...new Set(filter.sensitivities)];
  }

  if (filter.keys && filter.keys.length > 0) {
    const keys = uniqSortedStrings(filter.keys);
    if (keys.length > MAX_FILTER_KEYS) {
      throw invalidRequestError(`too many filter.keys (max=${MAX_FILTER_KEYS})`);
    }
    if (keys.length > 0) next.keys = keys;
  }

  if (filter.tags && filter.tags.length > 0) {
    const tags = uniqSortedStrings(filter.tags);
    if (tags.length > MAX_FILTER_TAGS) {
      throw invalidRequestError(`too many filter.tags (max=${MAX_FILTER_TAGS})`);
    }
    if (tags.length > 0) next.tags = tags;
  }

  if (filter.provenance) {
    const provenance: NonNullable<MemoryItemFilter["provenance"]> = {};
    if (filter.provenance.source_kinds && filter.provenance.source_kinds.length > 0) {
      provenance.source_kinds = [...new Set(filter.provenance.source_kinds)];
    }
    if (filter.provenance.channels && filter.provenance.channels.length > 0) {
      const channels = uniqSortedStrings(filter.provenance.channels);
      if (channels.length > MAX_FILTER_PROVENANCE_VALUES) {
        throw invalidRequestError(
          `too many filter.provenance.channels (max=${MAX_FILTER_PROVENANCE_VALUES})`,
        );
      }
      if (channels.length > 0) provenance.channels = channels;
    }
    if (filter.provenance.thread_ids && filter.provenance.thread_ids.length > 0) {
      const threadIds = uniqSortedStrings(filter.provenance.thread_ids);
      if (threadIds.length > MAX_FILTER_PROVENANCE_VALUES) {
        throw invalidRequestError(
          `too many filter.provenance.thread_ids (max=${MAX_FILTER_PROVENANCE_VALUES})`,
        );
      }
      if (threadIds.length > 0) provenance.thread_ids = threadIds;
    }
    if (filter.provenance.session_ids && filter.provenance.session_ids.length > 0) {
      const sessionIds = uniqSortedStrings(filter.provenance.session_ids);
      if (sessionIds.length > MAX_FILTER_PROVENANCE_VALUES) {
        throw invalidRequestError(
          `too many filter.provenance.session_ids (max=${MAX_FILTER_PROVENANCE_VALUES})`,
        );
      }
      if (sessionIds.length > 0) provenance.session_ids = sessionIds;
    }
    if (Object.keys(provenance).length > 0) next.provenance = provenance;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function scoreAndRankRows(
  rows: RawSearchRow[],
  terms: string[],
): Array<{
  memory_item_id: string;
  kind: MemoryItemKind;
  score: number;
  provenance: MemoryProvenance;
  _created_at: string;
  snippet?: string;
}> {
  return rows.map((row) => {
    const provenance: MemoryProvenance = {
      source_kind: row.source_kind,
      refs: parseJson<string[]>(row.refs_json),
    };
    if (row.channel) provenance.channel = row.channel;
    if (row.thread_id) provenance.thread_id = row.thread_id;
    if (row.session_id) provenance.session_id = row.session_id;
    if (row.message_id) provenance.message_id = row.message_id;
    if (row.tool_call_id) provenance.tool_call_id = row.tool_call_id;
    if (row.metadata_json) provenance.metadata = parseJson<unknown>(row.metadata_json);

    const title = row.title ?? "";
    const key = row.key ?? "";
    const body = row.body_md ? markdownToPlainText(row.body_md) : "";
    const summary = row.summary_md ? markdownToPlainText(row.summary_md) : "";

    const titleLower = title.toLowerCase();
    const keyLower = key.toLowerCase();
    const bodyLower = body.toLowerCase();
    const summaryLower = summary.toLowerCase();

    let score = 0;
    for (const term of terms) {
      if (titleLower.includes(term)) score += 3;
      if (keyLower.includes(term)) score += 2;
      if (summaryLower.includes(term)) score += 2;
      if (bodyLower.includes(term)) score += 1;
    }

    const snippetSource =
      terms.length > 0 && titleLower && terms.some((t) => titleLower.includes(t))
        ? title
        : terms.length > 0 && bodyLower && terms.some((t) => bodyLower.includes(t))
          ? body
          : terms.length > 0 && summaryLower && terms.some((t) => summaryLower.includes(t))
            ? summary
            : key.length > 0
              ? key
              : title.length > 0
                ? title
                : body.length > 0
                  ? body
                  : summary;

    const snippet = snippetSource.length > 0 ? buildSnippet(snippetSource, terms, 240) : undefined;

    const hit: {
      memory_item_id: string;
      kind: MemoryItemKind;
      score: number;
      provenance: MemoryProvenance;
      _created_at: string;
      snippet?: string;
    } = {
      memory_item_id: row.memory_item_id,
      kind: row.kind,
      score: Math.max(0, score),
      provenance,
      _created_at: normalizeTime(row.created_at),
    };
    if (snippet) hit.snippet = snippet;
    return hit;
  });
}

export async function searchMemoryItems(
  db: SqlDb,
  input: MemorySearchInput,
  scope: Scope,
): Promise<MemorySearchResponse> {
  const query = input.query.trim();
  if (query.length === 0) {
    return { v: 1, hits: [], next_cursor: undefined };
  }

  const MAX_QUERY_CHARS = 1024;
  const MAX_TERMS = 12;
  const MAX_TERM_CHARS = 64;
  const MAX_CANDIDATE_LIMIT = 1000;
  const MAX_SQL_PARAMS = 900;

  if (query !== "*" && query.length > MAX_QUERY_CHARS) {
    throw invalidRequestError(`query too long (max=${MAX_QUERY_CHARS})`);
  }

  const rawTerms =
    query === "*"
      ? []
      : query
          .split(/\s+/g)
          .map((term) => term.trim())
          .filter(Boolean);
  if (rawTerms.some((term) => term.length > MAX_TERM_CHARS)) {
    throw invalidRequestError(`query term too long (max=${MAX_TERM_CHARS})`);
  }

  const terms = uniqSortedStrings(rawTerms.map((term) => term.toLowerCase()));

  if (terms.length > MAX_TERMS) {
    throw invalidRequestError(`too many query terms (max=${MAX_TERMS})`);
  }

  const limit = Math.max(1, Math.min(500, input.limit ?? 20));
  const candidateLimit = Math.min(Math.max(limit * 20, 200), MAX_CANDIDATE_LIMIT);

  const normalizedFilter = normalizeSearchFilter(input.filter);

  const queryParts = buildMemoryV1ItemQueryParts({
    tenantId: scope.tenantId,
    agentId: scope.agentId,
    filter: normalizedFilter,
    alwaysJoinProvenance: true,
  });
  const clauses: string[] = [...queryParts.where];
  const params: unknown[] = [...queryParts.values];

  if (terms.length > 0) {
    const contains =
      db.kind === "sqlite"
        ? (haystack: string): string => `instr(${haystack}, ?) > 0`
        : (haystack: string): string => `strpos(${haystack}, ?) > 0`;
    const termClauses: string[] = [];
    for (const term of terms) {
      termClauses.push(
        `(
            (i.title IS NOT NULL AND ${contains("LOWER(i.title)")})
            OR (i.body_md IS NOT NULL AND ${contains("LOWER(i.body_md)")})
            OR (i.summary_md IS NOT NULL AND ${contains("LOWER(i.summary_md)")})
            OR (i.key IS NOT NULL AND ${contains("LOWER(i.key)")})
          )`,
      );
      params.push(term, term, term, term);
    }

    clauses.push(`(${termClauses.join("\n            OR ")})`);
  }

  const totalParams = params.length + 1; // include LIMIT
  if (totalParams > MAX_SQL_PARAMS) {
    throw invalidRequestError(`search too complex (params=${totalParams}, max=${MAX_SQL_PARAMS})`);
  }

  const rows = await db.all<RawSearchRow>(
    `SELECT
         i.memory_item_id, i.kind, i.key, i.title, i.body_md, i.summary_md, i.created_at,
         p.source_kind, p.channel, p.thread_id, p.session_id, p.message_id,
         p.tool_call_id, p.refs_json, p.metadata_json
       FROM ${queryParts.from}
       WHERE ${clauses.join("\n         AND ")}
       ORDER BY i.created_at DESC
       LIMIT ?`,
    [...params, candidateLimit],
  );

  const scored = scoreAndRankRows(rows, terms);

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a._created_at !== b._created_at) return b._created_at.localeCompare(a._created_at);
    return a.memory_item_id.localeCompare(b.memory_item_id);
  });

  const hits = scored.slice(0, limit).map(({ _created_at, ...hit }) => hit);
  return { v: 1, hits, next_cursor: undefined };
}
