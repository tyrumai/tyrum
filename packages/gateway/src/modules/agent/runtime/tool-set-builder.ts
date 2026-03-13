import type { LanguageModel, ToolSet } from "ai";
import type { ToolDescriptor } from "../tools.js";
import type { ToolExecutor } from "../tool-executor.js";
import { resolvePolicyGatedPluginToolExposure } from "./plugin-tool-policy.js";
import type { AgentContextReport } from "./types.js";
import type { TurnMemoryDecisionCollector } from "./turn-memory-policy.js";
import type { LaneQueueState } from "./turn-engine-bridge.js";
import type {
  ToolExecutionContext,
  ToolCallPolicyState,
  ToolSetBuilderDeps,
} from "./tool-set-builder-helpers.js";
import { buildRuntimeToolSet } from "./tool-set-builder-execution.js";

export type { ToolCallPolicyState, ToolSetBuilderDeps } from "./tool-set-builder-helpers.js";

export class ToolSetBuilder {
  constructor(private readonly deps: ToolSetBuilderDeps) {}

  buildToolSet(
    tools: readonly ToolDescriptor[],
    toolExecutor: ToolExecutor,
    usedTools: Set<string>,
    toolExecutionContext: ToolExecutionContext,
    contextReport: AgentContextReport,
    laneQueue?: LaneQueueState,
    toolCallPolicyStates?: Map<string, ToolCallPolicyState>,
    model?: LanguageModel,
    turnMemoryDecisionCollector?: TurnMemoryDecisionCollector,
  ): ToolSet {
    return buildRuntimeToolSet({
      deps: this.deps,
      tools,
      toolExecutor,
      usedTools,
      toolExecutionContext,
      contextReport,
      laneQueue,
      toolCallPolicyStates,
      model,
      turnMemoryDecisionCollector,
    });
  }

  async resolvePolicyGatedPluginToolExposure(params: {
    allowlist: readonly string[];
    pluginTools: readonly ToolDescriptor[];
  }): Promise<{ allowlist: string[]; pluginTools: ToolDescriptor[] }> {
    return await resolvePolicyGatedPluginToolExposure({
      policyService: this.deps.policyService,
      tenantId: this.deps.tenantId,
      agentId: this.deps.agentId,
      allowlist: params.allowlist,
      pluginTools: params.pluginTools,
    });
  }
}
