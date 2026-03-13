import { z } from "zod";
import { MemorySensitivity } from "./memory.js";
import { AgentMcpConfig, AgentSkillConfig, AgentToolConfig } from "./agent-access.js";
import { canonicalizeToolIdList } from "./tool-id.js";

function asPlainObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stripLegacyPersonaFields(value: unknown): unknown {
  const parsed = asPlainObject(value);
  if (!parsed) return value;

  return {
    name: parsed["name"],
    tone: parsed["tone"],
    palette: parsed["palette"],
    character: parsed["character"],
  };
}

const ProviderModelId = z
  .string()
  .trim()
  .min(1)
  .regex(/^[^/\s]+\/.+$/, "model must be in provider/model format");

export const AgentModelConfig = z
  .object({
    model: ProviderModelId.nullable(),
    variant: z.string().trim().min(1).optional(),
    options: z.record(z.string(), z.unknown()).optional(),
    fallback: z.array(ProviderModelId).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.model !== null) return;
    if (value.variant) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "variant requires a primary model",
        path: ["variant"],
      });
    }
    if (value.options && Object.keys(value.options).length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "model options require a primary model",
        path: ["options"],
      });
    }
    if (value.fallback && value.fallback.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fallback models require a primary model",
        path: ["fallback"],
      });
    }
  });
export type AgentModelConfig = z.infer<typeof AgentModelConfig>;

export const AgentSessionLoopDetectionWithinTurnConfig = z.object({
  enabled: z.boolean().default(true),
  consecutive_repeat_limit: z.number().int().min(2).max(50).default(3),
  cycle_repeat_limit: z.number().int().min(2).max(50).default(3),
});
export type AgentSessionLoopDetectionWithinTurnConfig = z.infer<
  typeof AgentSessionLoopDetectionWithinTurnConfig
>;

export const AgentSessionLoopDetectionCrossTurnConfig = z.object({
  enabled: z.boolean().default(true),
  window_assistant_messages: z.number().int().min(1).max(20).default(3),
  similarity_threshold: z.number().min(0).max(1).default(0.97),
  min_chars: z.number().int().min(0).max(100_000).default(120),
  cooldown_assistant_messages: z.number().int().min(0).max(100).default(6),
});
export type AgentSessionLoopDetectionCrossTurnConfig = z.infer<
  typeof AgentSessionLoopDetectionCrossTurnConfig
>;

export const AgentSessionLoopDetectionConfig = z.object({
  within_turn: AgentSessionLoopDetectionWithinTurnConfig.prefault({}),
  cross_turn: AgentSessionLoopDetectionCrossTurnConfig.prefault({}),
});
export type AgentSessionLoopDetectionConfig = z.infer<typeof AgentSessionLoopDetectionConfig>;

export const AgentSessionConfig = z.object({
  ttl_days: z.number().int().min(1).max(365).default(365),
  max_turns: z.number().int().min(0).max(500).default(0),
  compaction: z
    .object({
      auto: z.boolean().default(true),
      reserved_input_tokens: z.number().int().min(0).max(400_000).default(20_000),
      keep_last_messages_after_compaction: z.number().int().min(0).max(200).default(2),
    })
    .prefault({}),
  loop_detection: AgentSessionLoopDetectionConfig.prefault({}),
  context_pruning: z
    .object({
      max_messages: z.union([z.literal(0), z.number().int().min(8).max(2000)]).default(0),
      tool_prune_keep_last_messages: z.number().int().min(2).max(2000).default(4),
    })
    .prefault({}),
});
export type AgentSessionConfig = z.infer<typeof AgentSessionConfig>;

export const BuiltinMemoryServerSettings = z
  .object({
    enabled: z.boolean().default(true),
    allow_sensitivities: z.array(MemorySensitivity).default(["public", "private"]),
    structured: z
      .object({
        fact_keys: z.array(z.string().trim().min(1)).default([]),
        tags: z.array(z.string().trim().min(1)).default([]),
      })
      .prefault({}),
    keyword: z
      .object({
        enabled: z.boolean().default(true),
        limit: z.number().int().min(1).max(200).default(60),
      })
      .prefault({}),
    semantic: z
      .object({
        enabled: z.boolean().default(true),
        limit: z.number().int().min(1).max(200).default(20),
      })
      .prefault({}),
    budgets: z
      .object({
        max_total_items: z.number().int().min(0).max(1000).default(12),
        max_total_chars: z.number().int().min(0).max(200_000).default(2400),
        max_total_tokens: z.number().int().min(0).max(400_000).optional(),
        per_kind: z
          .object({
            fact: z
              .object({
                max_items: z.number().int().min(0).max(1000).default(6),
                max_chars: z.number().int().min(0).max(200_000).default(800),
                max_tokens: z.number().int().min(0).max(400_000).optional(),
              })
              .prefault({}),
            note: z
              .object({
                max_items: z.number().int().min(0).max(1000).default(4),
                max_chars: z.number().int().min(0).max(200_000).default(1200),
                max_tokens: z.number().int().min(0).max(400_000).optional(),
              })
              .prefault({}),
            procedure: z
              .object({
                max_items: z.number().int().min(0).max(1000).default(3),
                max_chars: z.number().int().min(0).max(200_000).default(1200),
                max_tokens: z.number().int().min(0).max(400_000).optional(),
              })
              .prefault({}),
            episode: z
              .object({
                max_items: z.number().int().min(0).max(1000).default(2),
                max_chars: z.number().int().min(0).max(200_000).default(800),
                max_tokens: z.number().int().min(0).max(400_000).optional(),
              })
              .prefault({}),
          })
          .prefault({}),
      })
      .prefault({}),
  })
  .prefault({});
export type BuiltinMemoryServerSettings = z.infer<typeof BuiltinMemoryServerSettings>;

export const AgentPersona = z.preprocess(
  stripLegacyPersonaFields,
  z
    .object({
      name: z.string().trim().min(1),
      tone: z.string().trim().min(1),
      palette: z.string().trim().min(1),
      character: z.string().trim().min(1),
    })
    .strict(),
);
export type AgentPersona = z.infer<typeof AgentPersona>;

export const AgentConfig = z
  .object({
    model: AgentModelConfig,
    persona: AgentPersona.optional(),
    skills: AgentSkillConfig.prefault({}),
    mcp: AgentMcpConfig.prefault({}),
    tools: AgentToolConfig.prefault({}),
    sessions: AgentSessionConfig.prefault({}),
  })
  .strict();
export type AgentConfig = z.infer<typeof AgentConfig>;

export const SkillRequires = z.object({
  tools: z.array(z.string().trim().min(1)).overwrite(canonicalizeToolIdList).optional(),
  mcp: z.array(z.string().trim().min(1)).optional(),
  nodes: z.array(z.string().trim().min(1)).optional(),
});
export type SkillRequires = z.infer<typeof SkillRequires>;

export const SkillFrontmatter = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  version: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  requires: SkillRequires.optional(),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatter>;

export const SkillManifest = z.object({
  meta: SkillFrontmatter,
  body: z.string(),
});
export type SkillManifest = z.infer<typeof SkillManifest>;

export const SkillProvenanceSource = z.enum(["workspace", "managed", "user", "bundled", "shared"]);
export type SkillProvenanceSource = z.infer<typeof SkillProvenanceSource>;

export const SkillStatus = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    version: z.string().trim().min(1),
    source: SkillProvenanceSource,
  })
  .strict();
export type SkillStatus = z.infer<typeof SkillStatus>;

export const McpToolMetadataOverride = z
  .object({
    description_override: z.string().trim().min(1).optional(),
    description_append: z.string().trim().min(1).optional(),
    risk: z.enum(["low", "medium", "high"]).optional(),
    requires_confirmation: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.description_override && value.description_append) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "use either description_override or description_append",
        path: ["description_append"],
      });
    }
  });
export type McpToolMetadataOverride = z.infer<typeof McpToolMetadataOverride>;

const McpServerBase = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  enabled: z.boolean(),
  timeout_ms: z.number().int().min(100).max(600_000).optional(),
  scopes: z.array(z.string().trim().min(1)).optional(),
  tool_overrides: z.record(z.string().trim().min(1), McpToolMetadataOverride).optional(),
});

const McpServerStdio = McpServerBase.extend({
  transport: z.literal("stdio").default("stdio"),
  command: z.string().trim().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().trim().min(1).optional(),
});

const McpServerRemote = McpServerBase.extend({
  transport: z.literal("remote"),
  url: z.string().trim().url(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const McpServerSpec = z.union([McpServerStdio, McpServerRemote]);
export type McpServerSpec = z.infer<typeof McpServerSpec>;
