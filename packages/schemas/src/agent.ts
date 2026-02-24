import { z } from "zod";
import { AgentId, WorkspaceId } from "./keys.js";
import { NormalizedContainerKind, NormalizedMessageEnvelope } from "./message.js";

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

export const AgentSessionConfig = z.object({
  ttl_days: z.number().int().min(1).max(365).default(30),
  max_turns: z.number().int().min(1).max(500).default(20),
});
export type AgentSessionConfig = z.infer<typeof AgentSessionConfig>;

export const AgentMemoryConfig = z.object({
  markdown_enabled: z.boolean().default(true),
});
export type AgentMemoryConfig = z.infer<typeof AgentMemoryConfig>;

export const AgentConfig = z.object({
  model: AgentModelConfig,
  skills: AgentSkillConfig.default({ enabled: [] }),
  mcp: AgentMcpConfig.default({ enabled: [] }),
  tools: AgentToolConfig.default({ allow: [] }),
  sessions: AgentSessionConfig.default({ ttl_days: 30, max_turns: 20 }),
  memory: AgentMemoryConfig.default({ markdown_enabled: true }),
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

export const AgentTurnRequest = z.object({
  agent_id: AgentId.optional(),
  workspace_id: WorkspaceId.optional(),
  channel: z.string().trim().min(1).optional(),
  thread_id: z.string().trim().min(1).optional(),
  container_kind: NormalizedContainerKind.optional(),
  message: z.string().trim().min(1).optional(),
  envelope: NormalizedMessageEnvelope.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).superRefine((value, ctx) => {
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
  session_id: z.string(),
  used_tools: z.array(z.string()).default([]),
  memory_written: z.boolean().default(false),
});
export type AgentTurnResponse = z.infer<typeof AgentTurnResponse>;

export const AgentStatusResponse = z.object({
  enabled: z.boolean(),
  home: z.string(),
  identity: z.object({
    name: z.string(),
    description: z.string().optional(),
  }),
  model: AgentModelConfig,
  skills: z.array(z.string()),
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
