import type { LanguageModel, ToolSet } from "ai";
import type { ToolDescriptor } from "../tools.js";
import type { ToolExecutor } from "../tool-executor.js";
import { resolvePolicyGatedPluginToolExposure } from "./plugin-tool-policy.js";
import type { AgentContextReport } from "./types.js";
import type { LaneQueueState } from "./turn-engine-bridge.js";
import type { GuardianReviewDecisionCollector } from "../../review/guardian-review-mode.js";
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
    memoryWriteState?: { wrote: boolean },
    guardianReviewDecisionCollector?: GuardianReviewDecisionCollector,
  ): ToolSet {
    return buildRuntimeToolSet({
      deps: this.deps,
      tools,
      toolExecutor,
      usedTools,
      memoryWriteState,
      toolExecutionContext,
      contextReport,
      laneQueue,
      toolCallPolicyStates,
      model,
      guardianReviewDecisionCollector,
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
