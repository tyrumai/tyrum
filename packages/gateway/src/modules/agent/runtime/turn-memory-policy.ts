import { stableJsonStringify, sha256HexFromString } from "../../policy/canonical-json.js";
import { z } from "zod";

const TurnMemoryTagSchema = z.string().trim().min(1).max(32);
const TurnMemoryReasonSchema = z.string().trim().min(1).max(240);

const TurnMemoryFactSchema = z
  .object({
    kind: z.literal("fact"),
    key: z.string().trim().min(1).max(160),
    value: z.unknown(),
    confidence: z.number().min(0).max(1).optional(),
    tags: z.array(TurnMemoryTagSchema).max(8).optional(),
  })
  .strict();

const TurnMemoryNoteSchema = z
  .object({
    kind: z.literal("note"),
    title: z.string().trim().min(1).max(120).optional(),
    body_md: z.string().trim().min(1).max(1_600),
    tags: z.array(TurnMemoryTagSchema).max(8).optional(),
  })
  .strict();

const TurnMemoryProcedureSchema = z
  .object({
    kind: z.literal("procedure"),
    title: z.string().trim().min(1).max(120).optional(),
    body_md: z.string().trim().min(1).max(1_600),
    confidence: z.number().min(0).max(1).optional(),
    tags: z.array(TurnMemoryTagSchema).max(8).optional(),
  })
  .strict();

const TurnMemoryEpisodeSchema = z
  .object({
    kind: z.literal("episode"),
    summary_md: z.string().trim().min(1).max(600),
    tags: z.array(TurnMemoryTagSchema).max(8).optional(),
  })
  .strict();

const TurnMemoryPayloadSchema = z.discriminatedUnion("kind", [
  TurnMemoryFactSchema,
  TurnMemoryNoteSchema,
  TurnMemoryProcedureSchema,
  TurnMemoryEpisodeSchema,
]);

export const TurnMemoryDecisionSchema = z.discriminatedUnion("should_store", [
  z
    .object({
      should_store: z.literal(false),
      reason: TurnMemoryReasonSchema,
    })
    .strict(),
  z
    .object({
      should_store: z.literal(true),
      reason: TurnMemoryReasonSchema,
      memory: TurnMemoryPayloadSchema,
    })
    .strict(),
]);

export type TurnMemoryDecision = z.infer<typeof TurnMemoryDecisionSchema>;
export type StoredTurnMemoryDecision = Extract<TurnMemoryDecision, { should_store: true }>;
export type TurnMemoryOrigin = "interaction" | "automation_quiet" | "automation_notify";

export type TurnMemoryDecisionCollector = {
  calls: number;
  invalidCalls: number;
  lastDecision?: TurnMemoryDecision;
  lastError?: string;
};

type AutomationPromptInput = {
  schedule_kind?: string | null;
  delivery_mode?: string | null;
};

function normalizeTagValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeTurnMemoryTags(tags: readonly string[] | undefined): string[] {
  const next = new Set<string>();
  for (const raw of tags ?? []) {
    const normalized = normalizeTagValue(raw);
    if (!normalized) continue;
    next.add(normalized);
    if (next.size >= 12) break;
  }
  return Array.from(next);
}

export function createTurnMemoryDecisionCollector(): TurnMemoryDecisionCollector {
  return { calls: 0, invalidCalls: 0 };
}

export function recordTurnMemoryDecision(
  collector: TurnMemoryDecisionCollector,
  args: unknown,
): { ok: boolean; error?: string } {
  collector.calls += 1;
  const parsed = TurnMemoryDecisionSchema.safeParse(args);
  if (!parsed.success) {
    collector.invalidCalls += 1;
    const error = parsed.error.issues[0]?.message ?? "invalid memory turn decision";
    collector.lastError = error;
    return { ok: false, error };
  }
  collector.lastDecision = parsed.data;
  collector.lastError = undefined;
  return { ok: true };
}

export function resolveTurnMemoryOrigin(
  metadata: Record<string, unknown> | undefined,
): TurnMemoryOrigin {
  const automation = metadata?.["automation"];
  if (!automation || typeof automation !== "object" || Array.isArray(automation)) {
    return "interaction";
  }
  const deliveryMode = (automation as Record<string, unknown>)["delivery_mode"];
  return deliveryMode === "quiet" ? "automation_quiet" : "automation_notify";
}

export function buildTurnMemoryProtocolPrompt(
  automation: AutomationPromptInput | null | undefined,
): string {
  const lines = [
    "Turn memory protocol:",
    "You must call `memory_turn_decision` exactly once on every normal turn.",
    "Default to should_store=false.",
    "Set should_store=true only when this turn yields durable, reusable, high-value information worth long-term memory.",
    "Do not store transcripts, generic acknowledgements, scheduler boilerplate, cadence metadata, or no-op status updates.",
    "When should_store=true, provide the full kind-specific memory payload under `memory`.",
  ];

  if (automation?.schedule_kind) {
    lines.push(
      "This is an automation-origin turn. Heartbeat/cron boilerplate and empty maintenance turns are usually should_store=false.",
    );
  }

  return lines.join("\n");
}

export function buildTurnMemoryDedupeKey(
  decision: StoredTurnMemoryDecision,
  origin: TurnMemoryOrigin,
): string {
  return sha256HexFromString(
    stableJsonStringify({
      origin,
      reason: decision.reason,
      memory: decision.memory,
    }),
  );
}
