import type { MemoryProvenanceSourceKind, MemorySensitivity } from "@tyrum/schemas";
import type { MemoryDal } from "./memory-dal.js";

export type MemorySystemEpisodeInput = {
  occurred_at: string;
  channel?: string;
  event_type: string;
  summary_md?: string;
  tags?: string[];
  sensitivity?: MemorySensitivity;
  metadata?: Record<string, unknown>;
  source_kind?: MemoryProvenanceSourceKind;
};

export async function recordMemorySystemEpisode(
  dal: MemoryDal,
  input: MemorySystemEpisodeInput,
  scope?: { tenantId?: string; agentId?: string } | string,
): Promise<void> {
  const summary = (input.summary_md ?? input.event_type).trim();
  if (!summary) {
    throw new Error("system episode summary cannot be empty");
  }

  const channel = input.channel?.trim();
  const provenance = {
    source_kind: input.source_kind ?? ("system" as const),
    refs: [],
    ...(channel ? { channel } : {}),
    metadata: input.metadata
      ? { event_type: input.event_type, ...input.metadata }
      : { event_type: input.event_type },
  };

  await dal.create(
    {
      kind: "episode",
      occurred_at: input.occurred_at,
      summary_md: summary,
      tags: ["system", `event:${input.event_type}`, ...(input.tags ?? [])],
      sensitivity: input.sensitivity ?? "private",
      provenance,
    },
    scope,
  );
}
