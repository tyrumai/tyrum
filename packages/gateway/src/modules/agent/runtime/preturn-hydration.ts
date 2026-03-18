import { randomUUID } from "node:crypto";
import { createToolSetPolicyRuntime } from "./tool-set-builder-policy.js";
import type { ToolDescriptor } from "../tools.js";
import type { ToolExecutor } from "../tool-executor.js";
import type { SessionRow } from "../session-dal.js";
import type { ResolvedAgentTurnInput } from "./turn-helpers.js";
import type { AgentContextPreTurnToolReport } from "./types.js";
import type { ToolExecutionContext, ToolSetBuilderDeps } from "./tool-set-builder-helpers.js";

type PreTurnHydrationSection = {
  toolId: string;
  text: string;
};

type PreTurnHydrationResult = {
  sections: PreTurnHydrationSection[];
  reports: AgentContextPreTurnToolReport[];
  memory: {
    keyword_hits: number;
    semantic_hits: number;
    structured_hits: number;
    included_items: number;
  };
};

function formatPreTurnHydrationError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function resolvePreferredPromptArgName(
  schema: Record<string, unknown> | undefined,
): string | undefined {
  const properties = asRecord(schema?.["properties"]);
  if (!properties) return undefined;

  for (const name of ["query", "prompt", "message", "text", "input", "request"]) {
    const prop = asRecord(properties[name]);
    if (prop?.["type"] === "string") return name;
  }

  const required = Array.isArray(schema?.["required"])
    ? schema["required"].filter((value): value is string => typeof value === "string")
    : [];
  for (const name of required) {
    const prop = asRecord(properties[name]);
    if (prop?.["type"] === "string") return name;
  }

  const stringProps = Object.entries(properties).filter(
    ([, prop]) => asRecord(prop)?.["type"] === "string",
  );
  return stringProps.length === 1 ? stringProps[0]?.[0] : undefined;
}

type ResolvedPreTurnHydration = {
  args: Record<string, unknown>;
  usedFallbackInference: boolean;
};

function buildPreTurnArgs(
  tool: ToolDescriptor,
  session: SessionRow,
  resolved: ResolvedAgentTurnInput,
): ResolvedPreTurnHydration | undefined {
  const explicitConfig = tool.preTurnHydration;
  const primaryArgName =
    explicitConfig?.promptArgName ?? resolvePreferredPromptArgName(asRecord(tool.inputSchema));
  if (!primaryArgName) {
    return undefined;
  }

  const args: Record<string, unknown> = {
    [primaryArgName]: resolved.message,
  };

  if (explicitConfig?.includeTurnContext ?? true) {
    args["turn"] = {
      agent_id: session.agent_id,
      workspace_id: session.workspace_id,
      session_id: session.session_id,
      channel: resolved.channel,
      thread_id: resolved.thread_id,
    };
  }

  return {
    args,
    usedFallbackInference: !explicitConfig,
  };
}

export async function runPreTurnHydration(params: {
  toolIds: readonly string[];
  availableTools: readonly ToolDescriptor[];
  toolExecutor: ToolExecutor;
  toolSetBuilderDeps: ToolSetBuilderDeps;
  toolExecutionContext: ToolExecutionContext;
  session: SessionRow;
  resolved: ResolvedAgentTurnInput;
}): Promise<PreTurnHydrationResult> {
  const sections: PreTurnHydrationSection[] = [];
  const reports: AgentContextPreTurnToolReport[] = [];
  const toolById = new Map(params.availableTools.map((tool) => [tool.id, tool]));
  const policyRuntime = createToolSetPolicyRuntime({
    deps: params.toolSetBuilderDeps,
    toolExecutionContext: params.toolExecutionContext,
  });
  const memory = {
    keyword_hits: 0,
    semantic_hits: 0,
    structured_hits: 0,
    included_items: 0,
  };

  for (const toolId of params.toolIds) {
    const tool = toolById.get(toolId);
    if (!tool) {
      reports.push({
        tool_id: toolId,
        status: "skipped",
        injected_chars: 0,
        error: "tool unavailable",
      });
      continue;
    }
    if (!tool.id.startsWith("mcp.")) {
      reports.push({
        tool_id: tool.id,
        status: "skipped",
        injected_chars: 0,
        error: "pre-turn hydration currently supports MCP tools only",
      });
      continue;
    }

    const hydration = buildPreTurnArgs(tool, params.session, params.resolved);
    if (!hydration) {
      reports.push({
        tool_id: tool.id,
        status: "skipped",
        injected_chars: 0,
        error:
          "pre-turn hydration metadata is missing and the tool schema did not expose a usable string prompt field",
      });
      continue;
    }
    if (hydration.usedFallbackInference) {
      params.toolSetBuilderDeps.logger.warn("agent.pre_turn_hydration_schema_fallback", {
        tool_id: tool.id,
      });
    }

    try {
      const toolCallId = `preturn-${randomUUID()}`;
      const policyState = await policyRuntime.resolveToolCallPolicyState({
        toolDesc: tool,
        toolCallId,
        args: hydration.args,
        inputProvenance: { source: "system", trusted: true },
      });
      if (policyState.shouldRequireApproval) {
        reports.push({
          tool_id: tool.id,
          status: "skipped",
          injected_chars: 0,
          error: "policy requires approval",
        });
        continue;
      }

      const result = await params.toolExecutor.execute(tool.id, toolCallId, hydration.args, {
        agent_id: params.session.agent_id,
        workspace_id: params.session.workspace_id,
        session_id: params.session.session_id,
        channel: params.resolved.channel,
        thread_id: params.resolved.thread_id,
      });

      if (result.error) {
        reports.push({
          tool_id: tool.id,
          status: "failed",
          injected_chars: 0,
          error: result.error,
        });
        continue;
      }

      if (result.meta?.kind === "memory.seed") {
        const meta = result.meta;
        const metaParts: string[] = [];
        if (meta.query) {
          metaParts.push(`seed_query="${meta.query}"`);
        }
        const hitParts: string[] = [];
        if (meta.structured_item_count > 0)
          hitParts.push(`structured=${meta.structured_item_count}`);
        if (meta.keyword_hit_count > 0) hitParts.push(`keyword=${meta.keyword_hit_count}`);
        if (meta.semantic_hit_count > 0) hitParts.push(`semantic=${meta.semantic_hit_count}`);
        const included = meta.included_item_ids.length;
        if (hitParts.length > 0) {
          hitParts.push(`included=${included}`);
          metaParts.push(hitParts.join(" "));
        }
        const header = metaParts.length > 0 ? `[${metaParts.join(" | ")}]\n` : "";
        const text = `Pre-turn recall (${tool.id}):\n${header}${result.output}`;
        sections.push({ toolId: tool.id, text });
        reports.push({
          tool_id: tool.id,
          status: "succeeded",
          injected_chars: text.length,
        });
        memory.keyword_hits += meta.keyword_hit_count;
        memory.semantic_hits += meta.semantic_hit_count;
        memory.structured_hits += meta.structured_item_count;
        memory.included_items += included;
      } else {
        const text = `Pre-turn recall (${tool.id}):\n${result.output}`;
        sections.push({ toolId: tool.id, text });
        reports.push({
          tool_id: tool.id,
          status: "succeeded",
          injected_chars: text.length,
        });
      }
    } catch (error) {
      reports.push({
        tool_id: tool.id,
        status: "failed",
        injected_chars: 0,
        error: formatPreTurnHydrationError(error),
      });
    }
  }

  return { sections, reports, memory };
}
