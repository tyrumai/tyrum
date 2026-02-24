import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";
import { AgentId, WorkspaceId } from "./keys.js";

export const ContextPartReport = z.object({
  id: z.string().trim().min(1),
  chars: z.number().int().nonnegative(),
}).passthrough();
export type ContextPartReport = z.infer<typeof ContextPartReport>;

export const ContextSystemPromptReport = z.object({
  chars: z.number().int().nonnegative(),
  sections: z.array(ContextPartReport).default([]),
}).passthrough();
export type ContextSystemPromptReport = z.infer<typeof ContextSystemPromptReport>;

export const ContextToolCallReport = z.object({
  tool_call_id: z.string().trim().min(1),
  tool_id: z.string().trim().min(1),
  injected_chars: z.number().int().nonnegative(),
}).passthrough();
export type ContextToolCallReport = z.infer<typeof ContextToolCallReport>;

export const ContextInjectedFileReport = z.object({
  tool_call_id: z.string().trim().min(1),
  path: z.string().trim().min(1),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  raw_chars: z.number().int().nonnegative(),
  selected_chars: z.number().int().nonnegative(),
  injected_chars: z.number().int().nonnegative(),
  truncated: z.boolean(),
  truncation_marker: z.string().trim().min(1).optional(),
}).passthrough();
export type ContextInjectedFileReport = z.infer<typeof ContextInjectedFileReport>;

export const ContextReport = z.object({
  context_report_id: UuidSchema,
  generated_at: DateTimeSchema,
  session_id: z.string().trim().min(1),
  channel: z.string().trim().min(1),
  thread_id: z.string().trim().min(1),
  agent_id: AgentId.default("default"),
  workspace_id: WorkspaceId.default("default"),
  system_prompt: ContextSystemPromptReport,
  user_parts: z.array(ContextPartReport).default([]),
  selected_tools: z.array(z.string().trim().min(1)).default([]),
  tool_schema_top: z.array(ContextPartReport).default([]),
  tool_schema_total_chars: z.number().int().nonnegative().default(0),
  enabled_skills: z.array(z.string().trim().min(1)).default([]),
  mcp_servers: z.array(z.string().trim().min(1)).default([]),
  memory: z
    .object({
      keyword_hits: z.number().int().nonnegative().default(0),
      semantic_hits: z.number().int().nonnegative().default(0),
    })
    .passthrough()
    .default({ keyword_hits: 0, semantic_hits: 0 }),
  tool_calls: z.array(ContextToolCallReport).default([]),
  injected_files: z.array(ContextInjectedFileReport).default([]),
}).passthrough();
export type ContextReport = z.infer<typeof ContextReport>;
