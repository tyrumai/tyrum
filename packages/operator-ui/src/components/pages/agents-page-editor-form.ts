import { AgentConfig, IdentityPack } from "@tyrum/schemas";
import type { AgentConfig as AgentConfigT, IdentityPack as IdentityPackT } from "@tyrum/schemas";

const DEFAULT_CONFIG = AgentConfig.parse({
  model: { model: "openai/gpt-4.1" },
});

const DEFAULT_IDENTITY = IdentityPack.parse({
  meta: {
    name: "New Agent",
    description: "Managed agent",
    style: {
      tone: "direct",
    },
  },
  body: "",
});

export type AgentEditorFormState = {
  agentKey: string;
  name: string;
  description: string;
  tone: string;
  palette: string;
  character: string;
  emoji: string;
  verbosity: string;
  format: string;
  identityBody: string;
  model: string;
  variant: string;
  fallbacks: string;
  skillsEnabled: string;
  workspaceSkillsTrusted: boolean;
  mcpEnabled: string;
  toolsAllowed: string;
  ttlDays: string;
  maxTurns: string;
  pruningMaxMessages: string;
  pruningToolKeep: string;
  withinTurnEnabled: boolean;
  withinTurnConsecutiveLimit: string;
  withinTurnCycleLimit: string;
  crossTurnEnabled: boolean;
  crossTurnWindowMessages: string;
  crossTurnSimilarityThreshold: string;
  crossTurnMinChars: string;
  crossTurnCooldownMessages: string;
  memoryEnabled: boolean;
  allowPublic: boolean;
  allowPrivate: boolean;
  allowSensitive: boolean;
  factKeys: string;
  memoryTags: string;
  keywordEnabled: boolean;
  keywordLimit: string;
  semanticEnabled: boolean;
  semanticLimit: string;
  totalItems: string;
  totalChars: string;
  totalTokens: string;
  factItems: string;
  factChars: string;
  factTokens: string;
  noteItems: string;
  noteChars: string;
  noteTokens: string;
  procedureItems: string;
  procedureChars: string;
  procedureTokens: string;
  episodeItems: string;
  episodeChars: string;
  episodeTokens: string;
};

export type AgentEditorSetField = <K extends keyof AgentEditorFormState>(
  key: K,
  value: AgentEditorFormState[K],
) => void;

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function joinList(values: string[] | undefined): string {
  return (values ?? []).join("\n");
}

export function snapshotToForm(snapshot: {
  agentKey: string;
  config: AgentConfigT;
  identity: IdentityPackT;
}): AgentEditorFormState {
  const config = snapshot.config;
  const identity = snapshot.identity;
  const budgets = config.memory.v1.budgets;
  const perKind = budgets.per_kind;
  return {
    agentKey: snapshot.agentKey,
    name: config.persona?.name ?? identity.meta.name,
    description: config.persona?.description ?? identity.meta.description ?? "",
    tone: config.persona?.tone ?? identity.meta.style?.tone ?? "direct",
    palette: config.persona?.palette ?? "graphite",
    character: config.persona?.character ?? "architect",
    emoji: identity.meta.emoji ?? "",
    verbosity: identity.meta.style?.verbosity ?? "",
    format: identity.meta.style?.format ?? "",
    identityBody: identity.body,
    model: config.model.model,
    variant: config.model.variant ?? "",
    fallbacks: joinList(config.model.fallback),
    skillsEnabled: joinList(config.skills.enabled),
    workspaceSkillsTrusted: config.skills.workspace_trusted,
    mcpEnabled: joinList(config.mcp.enabled),
    toolsAllowed: joinList(config.tools.allow),
    ttlDays: String(config.sessions.ttl_days),
    maxTurns: String(config.sessions.max_turns),
    pruningMaxMessages: String(config.sessions.context_pruning.max_messages),
    pruningToolKeep: String(config.sessions.context_pruning.tool_prune_keep_last_messages),
    withinTurnEnabled: config.sessions.loop_detection.within_turn.enabled,
    withinTurnConsecutiveLimit: String(
      config.sessions.loop_detection.within_turn.consecutive_repeat_limit,
    ),
    withinTurnCycleLimit: String(config.sessions.loop_detection.within_turn.cycle_repeat_limit),
    crossTurnEnabled: config.sessions.loop_detection.cross_turn.enabled,
    crossTurnWindowMessages: String(
      config.sessions.loop_detection.cross_turn.window_assistant_messages,
    ),
    crossTurnSimilarityThreshold: String(
      config.sessions.loop_detection.cross_turn.similarity_threshold,
    ),
    crossTurnMinChars: String(config.sessions.loop_detection.cross_turn.min_chars),
    crossTurnCooldownMessages: String(
      config.sessions.loop_detection.cross_turn.cooldown_assistant_messages,
    ),
    memoryEnabled: config.memory.v1.enabled,
    allowPublic: config.memory.v1.allow_sensitivities.includes("public"),
    allowPrivate: config.memory.v1.allow_sensitivities.includes("private"),
    allowSensitive: config.memory.v1.allow_sensitivities.includes("sensitive"),
    factKeys: joinList(config.memory.v1.structured.fact_keys),
    memoryTags: joinList(config.memory.v1.structured.tags),
    keywordEnabled: config.memory.v1.keyword.enabled,
    keywordLimit: String(config.memory.v1.keyword.limit),
    semanticEnabled: config.memory.v1.semantic.enabled,
    semanticLimit: String(config.memory.v1.semantic.limit),
    totalItems: String(budgets.max_total_items),
    totalChars: String(budgets.max_total_chars),
    totalTokens: budgets.max_total_tokens === undefined ? "" : String(budgets.max_total_tokens),
    factItems: String(perKind.fact.max_items),
    factChars: String(perKind.fact.max_chars),
    factTokens: perKind.fact.max_tokens === undefined ? "" : String(perKind.fact.max_tokens),
    noteItems: String(perKind.note.max_items),
    noteChars: String(perKind.note.max_chars),
    noteTokens: perKind.note.max_tokens === undefined ? "" : String(perKind.note.max_tokens),
    procedureItems: String(perKind.procedure.max_items),
    procedureChars: String(perKind.procedure.max_chars),
    procedureTokens:
      perKind.procedure.max_tokens === undefined ? "" : String(perKind.procedure.max_tokens),
    episodeItems: String(perKind.episode.max_items),
    episodeChars: String(perKind.episode.max_chars),
    episodeTokens:
      perKind.episode.max_tokens === undefined ? "" : String(perKind.episode.max_tokens),
  };
}

export function createBlankForm(): AgentEditorFormState {
  return snapshotToForm({
    agentKey: "",
    config: DEFAULT_CONFIG,
    identity: DEFAULT_IDENTITY,
  });
}

export function readPersonaFromForm(
  form: AgentEditorFormState,
): NonNullable<AgentConfigT["persona"]> {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    tone: form.tone.trim(),
    palette: form.palette.trim(),
    character: form.character.trim(),
  };
}

function parseOptionalInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return Number(trimmed);
}

export function buildPayload(
  form: AgentEditorFormState,
  preservedModelOptions?: Record<string, unknown>,
) {
  const allowSensitivities = [
    form.allowPublic ? "public" : null,
    form.allowPrivate ? "private" : null,
    form.allowSensitive ? "sensitive" : null,
  ].filter((value): value is "public" | "private" | "sensitive" => value !== null);

  const payload = {
    agent_key: form.agentKey.trim(),
    config: AgentConfig.parse({
      model: {
        model: form.model.trim(),
        ...(form.variant.trim() ? { variant: form.variant.trim() } : {}),
        ...(splitList(form.fallbacks).length > 0 ? { fallback: splitList(form.fallbacks) } : {}),
        ...(preservedModelOptions && Object.keys(preservedModelOptions).length > 0
          ? { options: preservedModelOptions }
          : {}),
      },
      persona: {
        ...readPersonaFromForm(form),
      },
      skills: {
        enabled: splitList(form.skillsEnabled),
        workspace_trusted: form.workspaceSkillsTrusted,
      },
      mcp: {
        enabled: splitList(form.mcpEnabled),
      },
      tools: {
        allow: splitList(form.toolsAllowed),
      },
      sessions: {
        ttl_days: Number(form.ttlDays),
        max_turns: Number(form.maxTurns),
        context_pruning: {
          max_messages: Number(form.pruningMaxMessages),
          tool_prune_keep_last_messages: Number(form.pruningToolKeep),
        },
        loop_detection: {
          within_turn: {
            enabled: form.withinTurnEnabled,
            consecutive_repeat_limit: Number(form.withinTurnConsecutiveLimit),
            cycle_repeat_limit: Number(form.withinTurnCycleLimit),
          },
          cross_turn: {
            enabled: form.crossTurnEnabled,
            window_assistant_messages: Number(form.crossTurnWindowMessages),
            similarity_threshold: Number(form.crossTurnSimilarityThreshold),
            min_chars: Number(form.crossTurnMinChars),
            cooldown_assistant_messages: Number(form.crossTurnCooldownMessages),
          },
        },
      },
      memory: {
        v1: {
          enabled: form.memoryEnabled,
          allow_sensitivities: allowSensitivities,
          structured: {
            fact_keys: splitList(form.factKeys),
            tags: splitList(form.memoryTags),
          },
          keyword: {
            enabled: form.keywordEnabled,
            limit: Number(form.keywordLimit),
          },
          semantic: {
            enabled: form.semanticEnabled,
            limit: Number(form.semanticLimit),
          },
          budgets: {
            max_total_items: Number(form.totalItems),
            max_total_chars: Number(form.totalChars),
            ...(parseOptionalInt(form.totalTokens) !== undefined
              ? { max_total_tokens: parseOptionalInt(form.totalTokens) }
              : {}),
            per_kind: {
              fact: {
                max_items: Number(form.factItems),
                max_chars: Number(form.factChars),
                ...(parseOptionalInt(form.factTokens) !== undefined
                  ? { max_tokens: parseOptionalInt(form.factTokens) }
                  : {}),
              },
              note: {
                max_items: Number(form.noteItems),
                max_chars: Number(form.noteChars),
                ...(parseOptionalInt(form.noteTokens) !== undefined
                  ? { max_tokens: parseOptionalInt(form.noteTokens) }
                  : {}),
              },
              procedure: {
                max_items: Number(form.procedureItems),
                max_chars: Number(form.procedureChars),
                ...(parseOptionalInt(form.procedureTokens) !== undefined
                  ? { max_tokens: parseOptionalInt(form.procedureTokens) }
                  : {}),
              },
              episode: {
                max_items: Number(form.episodeItems),
                max_chars: Number(form.episodeChars),
                ...(parseOptionalInt(form.episodeTokens) !== undefined
                  ? { max_tokens: parseOptionalInt(form.episodeTokens) }
                  : {}),
              },
            },
          },
        },
      },
    }),
    identity: IdentityPack.parse({
      meta: {
        name: form.name.trim(),
        ...(form.emoji.trim() ? { emoji: form.emoji.trim() } : {}),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        style: {
          tone: form.tone.trim(),
          ...(form.verbosity.trim() ? { verbosity: form.verbosity.trim() } : {}),
          ...(form.format.trim() ? { format: form.format.trim() } : {}),
        },
      },
      body: form.identityBody,
    }),
  };

  if (!payload.agent_key) {
    throw new Error("Agent key is required.");
  }

  return payload;
}
