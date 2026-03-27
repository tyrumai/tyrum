import { z } from "zod";
import { UuidSchema } from "./common.js";
import { TurnId } from "./execution.js";
import { AgentAccessDefaultMode, AgentToolConfig } from "./agent-access.js";
import {
  AgentConfig,
  AgentModelConfig,
  AgentPersona,
  AgentSessionConfig,
  SkillProvenanceSource,
  SkillStatus,
} from "./agent-core.js";
import { IdentityPack } from "./agent-identity.js";
import { AgentConversationKey, AgentId, AgentKey, TenantKey, WorkspaceKey } from "./keys.js";
import { NormalizedContainerKind, NormalizedMessageEnvelope } from "./message.js";
import { ArtifactRef } from "./artifact.js";
import { TyrumUIMessagePart } from "./ui-message.js";

function asPlainObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stripLegacyManagedAgentFields(value: unknown): unknown {
  const parsed = asPlainObject(value);
  if (!parsed || !("identity" in parsed)) return value;

  const copy = { ...parsed };
  delete copy["identity"];
  return copy;
}

export const AgentTurnRequest = z
  .object({
    tenant_key: TenantKey.optional(),
    agent_key: AgentKey.optional(),
    workspace_key: WorkspaceKey.optional(),
    channel: z.string().trim().min(1).optional(),
    thread_id: z.string().trim().min(1).optional(),
    container_kind: NormalizedContainerKind.optional(),
    parts: z.array(TyrumUIMessagePart).min(1).optional(),
    envelope: NormalizedMessageEnvelope.optional(),
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
    if (!value.parts || value.parts.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parts"],
        message: "parts are required when envelope is not provided",
      });
    }
  });
export type AgentTurnRequest = z.infer<typeof AgentTurnRequest>;

export const AgentTurnResponse = z.object({
  reply: z.string(),
  turn_id: TurnId.optional(),
  conversation_id: UuidSchema,
  conversation_key: AgentConversationKey,
  attachments: z.array(ArtifactRef).default([]),
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
    is_primary: z.boolean().optional(),
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
    is_primary: z.boolean(),
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
    is_primary: z.boolean(),
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

export const ManagedAgentCreateRequest = z.preprocess(
  stripLegacyManagedAgentFields,
  z
    .object({
      agent_key: AgentKey,
      config: AgentConfig,
      reason: z.string().trim().min(1).optional(),
    })
    .strict(),
);
export type ManagedAgentCreateRequest = z.infer<typeof ManagedAgentCreateRequest>;

export const ManagedAgentUpdateRequest = z.preprocess(
  stripLegacyManagedAgentFields,
  z
    .object({
      config: AgentConfig,
      reason: z.string().trim().min(1).optional(),
    })
    .strict(),
);
export type ManagedAgentUpdateRequest = z.infer<typeof ManagedAgentUpdateRequest>;

export const ManagedAgentRenameRequest = z
  .object({
    agent_key: AgentKey,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type ManagedAgentRenameRequest = z.infer<typeof ManagedAgentRenameRequest>;

export const ManagedAgentRenameResponse = ManagedAgentDetail;
export type ManagedAgentRenameResponse = z.infer<typeof ManagedAgentRenameResponse>;

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
  tool_access: AgentToolConfig.optional(),
  sessions: AgentSessionConfig,
});
export type AgentStatusResponse = z.infer<typeof AgentStatusResponse>;

export const AgentSkillCapability = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    version: z.string().trim().min(1).nullable(),
    source: SkillProvenanceSource,
  })
  .strict();
export type AgentSkillCapability = z.infer<typeof AgentSkillCapability>;

export const AgentMcpCapabilitySource = z.enum(["builtin", "workspace", "managed", "shared"]);
export type AgentMcpCapabilitySource = z.infer<typeof AgentMcpCapabilitySource>;

export const AgentMcpCapability = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    transport: z.enum(["stdio", "remote"]),
    source: AgentMcpCapabilitySource,
  })
  .strict();
export type AgentMcpCapability = z.infer<typeof AgentMcpCapability>;

export const AgentToolCapability = z
  .object({
    id: z.string().trim().min(1),
    description: z.string(),
    source: z.enum(["builtin", "builtin_mcp", "mcp", "plugin"]),
    family: z.string().trim().min(1).nullable(),
    backing_server_id: z.string().trim().min(1).nullable(),
  })
  .strict();
export type AgentToolCapability = z.infer<typeof AgentToolCapability>;

function capabilitySection<TItem extends z.ZodTypeAny, TExtra extends z.ZodRawShape = {}>(
  itemSchema: TItem,
  extraShape?: TExtra,
) {
  const baseShape = {
    default_mode: AgentAccessDefaultMode,
    allow: z.array(z.string().trim().min(1)),
    deny: z.array(z.string().trim().min(1)),
    items: z.array(itemSchema),
  };

  return z.object(extraShape ? { ...baseShape, ...extraShape } : baseShape).strict();
}

export const AgentCapabilitiesResponse = z
  .object({
    skills: capabilitySection(AgentSkillCapability, {
      workspace_trusted: z.boolean(),
    }),
    mcp: capabilitySection(AgentMcpCapability),
    tools: capabilitySection(AgentToolCapability),
  })
  .strict();
export type AgentCapabilitiesResponse = z.infer<typeof AgentCapabilitiesResponse>;
