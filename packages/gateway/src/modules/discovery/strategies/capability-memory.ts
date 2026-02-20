/**
 * Discovery strategy that resolves queries against capability memories.
 *
 * Ranks results by success_count weighted by recency.
 */

import type { DiscoveryRequest, DiscoveryResolution } from "@tyrum/schemas";
import type { CapabilityMemoryRow } from "../../memory/dal.js";

export interface CapabilityMemorySource {
  getCapabilityMemories(capabilityType?: string): Promise<CapabilityMemoryRow[]>;
}

/** Weight factor applied per day of age — older entries score lower. */
const RECENCY_DECAY_PER_DAY = 0.02;

function recencyWeight(lastSuccessAt: string | null): number {
  if (!lastSuccessAt) return 0.5;
  const ageMs = Date.now() - new Date(lastSuccessAt).getTime();
  const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));
  return Math.max(0.1, 1 - ageDays * RECENCY_DECAY_PER_DAY);
}

function normalizeUrl(identifier: string): string {
  try {
    new URL(identifier);
    return identifier;
  } catch {
    // Bare domain or path — assume https
    return `https://${identifier}`;
  }
}

function matchesQuery(row: CapabilityMemoryRow, query: string): boolean {
  const q = query.toLowerCase();
  const fields = [
    row.capability_type,
    row.capability_identifier,
    row.executor_kind,
    row.result_summary ?? "",
  ];
  return fields.some((f) => f.toLowerCase().includes(q));
}

export async function resolveFromCapabilityMemory(
  request: DiscoveryRequest,
  source: CapabilityMemorySource,
): Promise<DiscoveryResolution[]> {
  const rows = await source.getCapabilityMemories();
  const matches = rows.filter((row) => matchesQuery(row, request.query));

  const scored = matches.map((row) => ({
    row,
    score: row.success_count * recencyWeight(row.last_success_at),
  }));

  scored.sort((a, b) => b.score - a.score);

  const limit = request.max_results ?? 5;
  return scored.slice(0, limit).map((entry, index) => ({
    strategy: "structured_api" as const,
    connector_url: normalizeUrl(entry.row.capability_identifier),
    label: `${entry.row.capability_type}:${entry.row.executor_kind}`,
    rank: index,
    metadata: {
      success_count: entry.row.success_count,
      last_success_at: entry.row.last_success_at,
      result_summary: entry.row.result_summary,
    },
  }));
}
