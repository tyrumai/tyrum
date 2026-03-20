import { randomUUID } from "node:crypto";
import { ContextReport as ContextReportSchema } from "@tyrum/contracts";
import type { ToolDescriptor } from "../tools.js";
import type { AgentContextReport, AgentLoadedContext } from "./types.js";
import type { ResolvedExecutionProfile } from "./execution-profile-resolution.js";
import type { ResolvedAgentTurnInput } from "./turn-helpers.js";
import type { SessionRow } from "../session-dal.js";

export interface ContextReportInput {
  session: SessionRow;
  resolved: ResolvedAgentTurnInput;
  ctx: AgentLoadedContext;
  executionProfile: ResolvedExecutionProfile;
  filteredTools: ToolDescriptor[];
  systemPrompt: string;
  identityPrompt: string;
  promptContractPrompt: string;
  runtimePrompt: string;
  safetyPrompt: string;
  sandboxPrompt: string;
  skillsText: string;
  toolsText: string;
  workOrchestrationText: string | undefined;
  memoryGuidanceText: string | undefined;
  sessionText: string;
  workFocusText: string;
  preTurnTexts: string[];
  preTurnReports: AgentContextReport["pre_turn_tools"];
  automationDirectiveText: string | undefined;
  automationContextText: string | undefined;
  memorySummary: {
    keyword_hits: number;
    semantic_hits: number;
    structured_hits: number;
    included_items: number;
  };
  automation:
    | {
        schedule_kind?: string;
        schedule_id?: string;
        delivery_mode?: string;
      }
    | undefined;
  logger: { warn: (msg: string, data?: Record<string, unknown>) => void };
}

export function buildContextReport(input: ContextReportInput): AgentContextReport {
  const {
    session,
    resolved,
    ctx,
    executionProfile,
    filteredTools,
    systemPrompt,
    identityPrompt,
    promptContractPrompt,
    runtimePrompt,
    safetyPrompt,
    sandboxPrompt,
    skillsText,
    toolsText,
    workOrchestrationText,
    memoryGuidanceText,
    sessionText,
    workFocusText,
    preTurnTexts,
    preTurnReports,
    automationDirectiveText,
    automationContextText,
    memorySummary,
    automation,
    logger,
  } = input;

  const toolSchemaParts = filteredTools.map((t) => {
    const schema = t.inputSchema ?? { type: "object", additionalProperties: true };
    let chars = 0;
    try {
      chars = JSON.stringify(schema).length;
    } catch {
      // Intentional: schema size accounting is best-effort; treat non-serializable schemas as 0 chars.
      chars = 0;
    }
    return { id: t.id, chars };
  });
  const toolSchemaTotalChars = toolSchemaParts.reduce((total, part) => total + part.chars, 0);
  const toolSchemaTop = toolSchemaParts.toSorted((a, b) => b.chars - a.chars).slice(0, 5);

  const contextReportId = randomUUID();
  const report: AgentContextReport = {
    context_report_id: contextReportId,
    generated_at: new Date().toISOString(),
    session_id: session.session_id,
    channel: resolved.channel,
    thread_id: resolved.thread_id,
    agent_id: session.agent_id,
    workspace_id: session.workspace_id,
    system_prompt: {
      chars: systemPrompt.length,
      sections: [
        { id: "identity", chars: identityPrompt.length },
        { id: "prompt_contract", chars: promptContractPrompt.length },
        { id: "runtime", chars: runtimePrompt.length },
        { id: "safety", chars: safetyPrompt.length },
        { id: "sandbox", chars: sandboxPrompt.length },
        { id: "skill_guidance", chars: skillsText.length },
        { id: "tool_contracts", chars: toolsText.length },
        { id: "work_orchestration", chars: workOrchestrationText?.length ?? 0 },
        { id: "memory_guidance", chars: memoryGuidanceText?.length ?? 0 },
      ],
    },
    user_parts: [
      { id: "session_state", chars: sessionText.length },
      { id: "work_state", chars: workFocusText.length },
      ...preTurnTexts.map((text, index) => ({
        id: `pre_turn_recall_${String(index + 1)}`,
        chars: text.length,
      })),
      ...(automationDirectiveText
        ? [{ id: "automation_directive", chars: automationDirectiveText.length }]
        : []),
      ...(automationContextText
        ? [{ id: "automation_context", chars: automationContextText.length }]
        : []),
      { id: "user_request", chars: resolved.message.length },
    ],
    selected_tools: filteredTools.map((t) => t.id),
    execution_profile: executionProfile.id,
    execution_profile_source: executionProfile.source,
    tool_schema_top: toolSchemaTop,
    tool_schema_total_chars: toolSchemaTotalChars,
    enabled_skills: ctx.skills.map((s) => s.meta.id),
    mcp_servers: ctx.mcpServers.map((s) => s.id),
    ...(automation
      ? {
          automation: {
            schedule_kind: automation.schedule_kind,
            schedule_id: automation.schedule_id,
            delivery_mode: automation.delivery_mode,
          },
        }
      : {}),
    memory: memorySummary,
    pre_turn_tools: preTurnReports,
    tool_calls: [],
    injected_files: [],
  };

  const validated = ContextReportSchema.safeParse(report);
  if (validated.success) {
    return validated.data as unknown as AgentContextReport;
  }
  logger.warn("context_report.invalid", {
    context_report_id: contextReportId,
    session_id: session.session_id,
    error: validated.error.message,
  });
  return report;
}
