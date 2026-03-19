import { AgentConfig, BuiltinMemoryServerSettings } from "@tyrum/contracts";
import type { AgentConfig as AgentConfigT, IdentityPack as IdentityPackT } from "@tyrum/contracts";

const DEFAULT_CONFIG = AgentConfig.parse({
  model: { model: null },
});

function sortIds(values: readonly string[] | undefined): string[] {
  return [...(values ?? [])].toSorted((left, right) => left.localeCompare(right));
}

export type AgentEditorFormState = {
  agentKey: string;
  name: string;
  tone: string;
  palette: string;
  character: string;
  model: string;
  variant: string;
  fallbacks: string;
  skillsDefaultMode: "allow" | "deny";
  skillsAllow: string[];
  skillsDeny: string[];
  workspaceSkillsTrusted: boolean;
  mcpDefaultMode: "allow" | "deny";
  mcpAllow: string[];
  mcpDeny: string[];
  toolsDefaultMode: "allow" | "deny";
  toolsAllow: string[];
  toolsDeny: string[];
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
  memorySettingsMode: "inherit" | "override";
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

export type PreservedMcpConfig = Pick<AgentConfigT["mcp"], "pre_turn_tools" | "server_settings">;

export function splitList(value: string): string[] {
  return value
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function joinList(values: string[] | undefined): string {
  return (values ?? []).join("\n");
}

export function snapshotToForm(snapshot: {
  agentKey: string;
  config: AgentConfigT;
  identity?: IdentityPackT;
}): AgentEditorFormState {
  const config = snapshot.config;
  const hasExplicitMemorySettings = Object.prototype.hasOwnProperty.call(
    config.mcp.server_settings,
    "memory",
  );
  const memory = BuiltinMemoryServerSettings.parse(config.mcp.server_settings["memory"] ?? {});
  const budgets = memory.budgets;
  const perKind = budgets.per_kind;
  return {
    agentKey: snapshot.agentKey,
    name: config.persona?.name ?? snapshot.identity?.meta.name ?? "New Agent",
    tone: config.persona?.tone ?? snapshot.identity?.meta.style?.tone ?? "direct",
    palette: config.persona?.palette ?? "graphite",
    character: config.persona?.character ?? "architect",
    model: config.model.model ?? "",
    variant: config.model.variant ?? "",
    fallbacks: joinList(config.model.fallback),
    skillsDefaultMode: config.skills.default_mode,
    skillsAllow: sortIds(config.skills.allow),
    skillsDeny: sortIds(config.skills.deny),
    workspaceSkillsTrusted: config.skills.workspace_trusted,
    mcpDefaultMode: config.mcp.default_mode,
    mcpAllow: sortIds(config.mcp.allow),
    mcpDeny: sortIds(config.mcp.deny),
    toolsDefaultMode: config.tools.default_mode,
    toolsAllow: sortIds(config.tools.allow),
    toolsDeny: sortIds(config.tools.deny),
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
    memorySettingsMode: hasExplicitMemorySettings ? "override" : "inherit",
    memoryEnabled: memory.enabled,
    allowPublic: memory.allow_sensitivities.includes("public"),
    allowPrivate: memory.allow_sensitivities.includes("private"),
    allowSensitive: memory.allow_sensitivities.includes("sensitive"),
    factKeys: joinList(memory.structured.fact_keys),
    memoryTags: joinList(memory.structured.tags),
    keywordEnabled: memory.keyword.enabled,
    keywordLimit: String(memory.keyword.limit),
    semanticEnabled: memory.semantic.enabled,
    semanticLimit: String(memory.semantic.limit),
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
  });
}

function readPersonaFromForm(form: AgentEditorFormState): NonNullable<AgentConfigT["persona"]> {
  return {
    name: form.name.trim(),
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

export function buildMemoryServerSettings(
  form: AgentEditorFormState,
): ReturnType<typeof BuiltinMemoryServerSettings.parse> {
  const allowSensitivities = [
    form.allowPublic ? "public" : null,
    form.allowPrivate ? "private" : null,
    form.allowSensitive ? "sensitive" : null,
  ].filter((value): value is "public" | "private" | "sensitive" => value !== null);

  return BuiltinMemoryServerSettings.parse({
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
  });
}

export function applyMemorySettingsToForm(
  form: AgentEditorFormState,
  settings: Record<string, unknown> | undefined,
  mode: AgentEditorFormState["memorySettingsMode"] = form.memorySettingsMode,
): AgentEditorFormState {
  const memory = BuiltinMemoryServerSettings.parse(settings ?? {});
  const budgets = memory.budgets;
  const perKind = budgets.per_kind;
  return {
    ...form,
    memorySettingsMode: mode,
    memoryEnabled: memory.enabled,
    allowPublic: memory.allow_sensitivities.includes("public"),
    allowPrivate: memory.allow_sensitivities.includes("private"),
    allowSensitive: memory.allow_sensitivities.includes("sensitive"),
    factKeys: joinList(memory.structured.fact_keys),
    memoryTags: joinList(memory.structured.tags),
    keywordEnabled: memory.keyword.enabled,
    keywordLimit: String(memory.keyword.limit),
    semanticEnabled: memory.semantic.enabled,
    semanticLimit: String(memory.semantic.limit),
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

export function buildPayload(
  form: AgentEditorFormState,
  preservedModelOptions?: Record<string, unknown>,
  preservedMcpConfig?: PreservedMcpConfig,
) {
  const primaryModel = form.model.trim();
  const memorySettings = buildMemoryServerSettings(form);
  const preservedServerSettings = preservedMcpConfig?.server_settings ?? {};
  const preTurnTools =
    preservedMcpConfig?.pre_turn_tools ??
    (form.memorySettingsMode === "inherit" || form.memoryEnabled ? ["mcp.memory.seed"] : []);
  const serverSettings =
    form.memorySettingsMode === "inherit"
      ? Object.fromEntries(
          Object.entries(preservedServerSettings).filter(([key]) => key !== "memory"),
        )
      : {
          ...preservedServerSettings,
          memory: memorySettings,
        };
  const payload = {
    agent_key: form.agentKey.trim(),
    config: AgentConfig.parse({
      model:
        primaryModel.length === 0
          ? { model: null }
          : {
              model: primaryModel,
              ...(form.variant.trim() ? { variant: form.variant.trim() } : {}),
              ...(splitList(form.fallbacks).length > 0
                ? { fallback: splitList(form.fallbacks) }
                : {}),
              ...(preservedModelOptions && Object.keys(preservedModelOptions).length > 0
                ? { options: preservedModelOptions }
                : {}),
            },
      persona: {
        ...readPersonaFromForm(form),
      },
      skills: {
        default_mode: form.skillsDefaultMode,
        allow: form.skillsAllow,
        deny: form.skillsDeny,
        workspace_trusted: form.workspaceSkillsTrusted,
      },
      mcp: {
        default_mode: form.mcpDefaultMode,
        allow: form.mcpAllow,
        deny: form.mcpDeny,
        ...(preTurnTools.length ? { pre_turn_tools: preTurnTools } : {}),
        server_settings: serverSettings,
      },
      tools: {
        default_mode: form.toolsDefaultMode,
        allow: form.toolsAllow,
        deny: form.toolsDeny,
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
    }),
  };

  if (!payload.agent_key) {
    throw new Error("Agent key is required.");
  }

  return payload;
}
