import { z } from "zod";
import { AgentId, AgentKey, TenantKey, WorkspaceKey, AgentSessionKey } from "./keys.js";
import { UuidSchema } from "./common.js";
import { NormalizedContainerKind, NormalizedMessageEnvelope } from "./message.js";
import { MemorySensitivity } from "./memory.js";

export const AgentModelConfig = z.object({
  model: z
    .string()
    .trim()
    .min(1)
    .regex(/^[^/\s]+\/.+$/, "model must be in provider/model format"),
  variant: z.string().trim().min(1).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  fallback: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .regex(/^[^/\s]+\/.+$/, "fallback model must be in provider/model format"),
    )
    .optional(),
});
export type AgentModelConfig = z.infer<typeof AgentModelConfig>;

export const AgentSkillConfig = z.object({
  enabled: z.array(z.string().trim().min(1)).default([]),
  workspace_trusted: z.boolean().default(false),
});
export type AgentSkillConfig = z.infer<typeof AgentSkillConfig>;

export const AgentMcpConfig = z.object({
  enabled: z.array(z.string().trim().min(1)).default([]),
});
export type AgentMcpConfig = z.infer<typeof AgentMcpConfig>;

export const AgentToolConfig = z.object({
  allow: z.array(z.string().trim().min(1)).default([]),
});
export type AgentToolConfig = z.infer<typeof AgentToolConfig>;

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
  ttl_days: z.number().int().min(1).max(365).default(30),
  max_turns: z.number().int().min(1).max(500).default(20),
  loop_detection: AgentSessionLoopDetectionConfig.prefault({}),
  context_pruning: z
    .object({
      max_messages: z.number().int().min(8).max(2000).default(32),
      tool_prune_keep_last_messages: z.number().int().min(2).max(2000).default(4),
    })
    .prefault({}),
});
export type AgentSessionConfig = z.infer<typeof AgentSessionConfig>;

export const AgentMemoryConfig = z.object({
  v1: z
    .object({
      enabled: z.boolean().default(true),
      auto_write: z
        .object({
          enabled: z.boolean().default(true),
          mode: z.literal("sparse").default("sparse"),
          classifier: z.enum(["model_assisted", "rule_based"]).default("model_assisted"),
        })
        .prefault({}),
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
          enabled: z.boolean().default(false),
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
    .prefault({}),
});
export type AgentMemoryConfig = z.infer<typeof AgentMemoryConfig>;

export const AgentPersona = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    tone: z.string().trim().min(1),
    palette: z.string().trim().min(1),
    character: z.string().trim().min(1),
  })
  .strict();
export type AgentPersona = z.infer<typeof AgentPersona>;

export const AgentConfig = z.object({
  model: AgentModelConfig,
  persona: AgentPersona.optional(),
  skills: AgentSkillConfig.prefault({}),
  mcp: AgentMcpConfig.prefault({}),
  tools: AgentToolConfig.prefault({}),
  sessions: AgentSessionConfig.prefault({}),
  memory: AgentMemoryConfig.prefault({}),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

export const IdentityStyle = z.object({
  tone: z.string().trim().min(1).optional(),
  verbosity: z.string().trim().min(1).optional(),
  format: z.string().trim().min(1).optional(),
});
export type IdentityStyle = z.infer<typeof IdentityStyle>;

export const IdentityFrontmatter = z.object({
  name: z.string().trim().min(1),
  emoji: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  style: IdentityStyle.optional(),
});
export type IdentityFrontmatter = z.infer<typeof IdentityFrontmatter>;

export const IdentityPack = z.object({
  meta: IdentityFrontmatter,
  body: z.string(),
});
export type IdentityPack = z.infer<typeof IdentityPack>;

export const SkillRequires = z.object({
  tools: z.array(z.string().trim().min(1)).optional(),
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

export const SkillProvenanceSource = z.enum(["workspace", "user", "bundled", "shared"]);
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

const McpServerBase = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  enabled: z.boolean(),
  timeout_ms: z.number().int().min(100).max(600_000).optional(),
  scopes: z.array(z.string().trim().min(1)).optional(),
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

export const AgentTurnRequest = z
  .object({
    tenant_key: TenantKey.optional(),
    agent_key: AgentKey.optional(),
    workspace_key: WorkspaceKey.optional(),
    channel: z.string().trim().min(1).optional(),
    thread_id: z.string().trim().min(1).optional(),
    container_kind: NormalizedContainerKind.optional(),
    message: z.string().trim().min(1).optional(),
    envelope: NormalizedMessageEnvelope.optional(),
    intake_mode: z.enum(["inline", "delegate_execute", "delegate_plan"]).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.envelope) {
      if (value.channel && value.channel !== value.envelope.delivery.channel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["channel"],
          message: "channel must match envelope.delivery.channel when envelope is provided",
        });
      }
      if (value.thread_id && value.thread_id !== value.envelope.container.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["thread_id"],
          message: "thread_id must match envelope.container.id when envelope is provided",
        });
      }
      return;
    }

    if (!value.channel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["channel"],
        message: "channel is required when envelope is not provided",
      });
    }
    if (!value.thread_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["thread_id"],
        message: "thread_id is required when envelope is not provided",
      });
    }
    if (!value.message) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["message"],
        message: "message is required when envelope is not provided",
      });
    }
  });
export type AgentTurnRequest = z.infer<typeof AgentTurnRequest>;

export const AgentTurnResponse = z.object({
  reply: z.string(),
  session_id: UuidSchema,
  session_key: AgentSessionKey,
  used_tools: z.array(z.string()).default([]),
  memory_written: z.boolean().default(false),
});
export type AgentTurnResponse = z.infer<typeof AgentTurnResponse>;

export const AgentListItem = z
  .object({
    agent_key: AgentKey,
    agent_id: AgentId.optional(),
    home: z.string().trim().min(1).optional(),
    has_config: z.boolean().optional(),
    persona: AgentPersona,
  })
  .strict();
export type AgentListItem = z.infer<typeof AgentListItem>;

export const AgentListResponse = z
  .object({
    agents: z.array(AgentListItem),
  })
  .strict();
export type AgentListResponse = z.infer<typeof AgentListResponse>;

export const AgentConfigListItem = z
  .object({
    agent_id: AgentId,
    agent_key: AgentKey,
    created_at: z.string().nullable(),
    updated_at: z.string().nullable(),
    has_config: z.boolean().optional(),
    persona: AgentPersona,
  })
  .strict();
export type AgentConfigListItem = z.infer<typeof AgentConfigListItem>;

export const AgentConfigListResponse = z
  .object({
    agents: z.array(AgentConfigListItem),
  })
  .strict();
export type AgentConfigListResponse = z.infer<typeof AgentConfigListResponse>;

export const AgentConfigGetResponse = z
  .object({
    revision: z.number().int().positive(),
    tenant_id: z.string().trim().min(1),
    agent_id: AgentId,
    agent_key: AgentKey,
    config: AgentConfig,
    persona: AgentPersona,
    config_sha256: z.string().trim().min(1),
    created_at: z.string().trim().min(1),
    created_by: z.unknown(),
    reason: z.string().trim().min(1).nullable(),
    reverted_from_revision: z.number().int().positive().nullable(),
  })
  .strict();
export type AgentConfigGetResponse = z.infer<typeof AgentConfigGetResponse>;

export const AgentConfigUpdateRequest = z
  .object({
    config: AgentConfig,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type AgentConfigUpdateRequest = z.infer<typeof AgentConfigUpdateRequest>;

export const AgentConfigUpdateResponse = AgentConfigGetResponse;
export type AgentConfigUpdateResponse = z.infer<typeof AgentConfigUpdateResponse>;

export const ManagedAgentSummary = z
  .object({
    agent_id: AgentId,
    agent_key: AgentKey,
    created_at: z.string().nullable(),
    updated_at: z.string().nullable(),
    has_config: z.boolean(),
    has_identity: z.boolean(),
    can_delete: z.boolean(),
    persona: AgentPersona,
  })
  .strict();
export type ManagedAgentSummary = z.infer<typeof ManagedAgentSummary>;

export const ManagedAgentListResponse = z
  .object({
    agents: z.array(ManagedAgentSummary),
  })
  .strict();
export type ManagedAgentListResponse = z.infer<typeof ManagedAgentListResponse>;

export const ManagedAgentDetail = ManagedAgentSummary.extend({
  config: AgentConfig,
  identity: IdentityPack,
  config_revision: z.number().int().positive().nullable(),
  identity_revision: z.number().int().positive().nullable(),
  config_sha256: z.string().trim().min(1).nullable(),
  identity_sha256: z.string().trim().min(1).nullable(),
});
export type ManagedAgentDetail = z.infer<typeof ManagedAgentDetail>;

export const ManagedAgentGetResponse = ManagedAgentDetail;
export type ManagedAgentGetResponse = z.infer<typeof ManagedAgentGetResponse>;

export const ManagedAgentCreateRequest = z
  .object({
    agent_key: AgentKey,
    config: AgentConfig,
    identity: IdentityPack.optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type ManagedAgentCreateRequest = z.infer<typeof ManagedAgentCreateRequest>;

export const ManagedAgentUpdateRequest = z
  .object({
    config: AgentConfig,
    identity: IdentityPack.optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type ManagedAgentUpdateRequest = z.infer<typeof ManagedAgentUpdateRequest>;

export const ManagedAgentDeleteResponse = z
  .object({
    agent_id: AgentId,
    agent_key: AgentKey,
    deleted: z.literal(true),
  })
  .strict();
export type ManagedAgentDeleteResponse = z.infer<typeof ManagedAgentDeleteResponse>;

export const AgentStatusResponse = z.object({
  enabled: z.boolean(),
  home: z.string(),
  persona: AgentPersona,
  identity: z.object({
    name: z.string(),
    description: z.string().optional(),
  }),
  model: AgentModelConfig,
  skills: z.array(z.string()),
  skills_detailed: z.array(SkillStatus).optional(),
  workspace_skills_trusted: z.boolean().optional(),
  mcp: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      enabled: z.boolean(),
      transport: z.enum(["stdio", "remote"]),
    }),
  ),
  tools: z.array(z.string()),
  sessions: AgentSessionConfig,
});
export type AgentStatusResponse = z.infer<typeof AgentStatusResponse>;
