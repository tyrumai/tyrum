import type { ConversationRow } from "../conversation-dal.js";
import {
  isToolAllowed,
  isToolAllowedWithDenylist,
  selectToolDirectory,
  type ToolDescriptor,
} from "../tools.js";
import { validateToolDescriptorInputSchema } from "../tool-schema.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";
import { ToolSetBuilder } from "./tool-set-builder.js";
import type { ToolSetBuilderDeps } from "./tool-set-builder.js";
import type { ResolvedExecutionProfile } from "./execution-profile-resolution.js";
import type { AgentLoadedContext } from "./types.js";
import type { TurnPreparationRuntimeDeps } from "./turn-preparation-runtime.js";
import { createToolExecutorForTurnPreparation } from "./turn-preparation-runtime-tooling.js";
import type { ToolExecutor } from "../tool-executor.js";
import { resolveRuntimeToolDescriptorSource } from "./runtime-tool-descriptor-source.js";

function resolveExplicitRuntimePluginAllowlist(params: {
  agentAllowlist: readonly string[];
  runtimeTools: readonly ToolDescriptor[];
}): string[] {
  const explicitAllowEntries = params.agentAllowlist.filter((entry) => {
    const normalized = entry.trim();
    return normalized.length > 0 && !normalized.includes("*") && !normalized.includes("?");
  });
  const selected = new Set<string>();

  for (const tool of params.runtimeTools) {
    if (
      (tool.source === "plugin" || tool.id.trim().startsWith("plugin.")) &&
      isToolAllowed(explicitAllowEntries, tool.id)
    ) {
      selected.add(tool.id);
    }
  }

  return [...selected];
}

const DEEP_WORKBOARD_TOOL_PREFIXES = [
  "workboard.item.",
  "workboard.task.",
  "workboard.artifact.",
  "workboard.decision.",
  "workboard.signal.",
  "workboard.state.",
] as const;

function isDeepWorkboardTool(toolId: string): boolean {
  return DEEP_WORKBOARD_TOOL_PREFIXES.some((prefix) => toolId.startsWith(prefix));
}

function canRecoverDeepWorkboardTools(executionProfileId: ResolvedExecutionProfile["id"]): boolean {
  return executionProfileId === "planner" || executionProfileId === "executor_rw";
}

function resolveExplicitRuntimeWorkboardRecoveryAllowlist(params: {
  executionProfileId: ResolvedExecutionProfile["id"];
  toolConfig: Pick<AgentLoadedContext["config"]["tools"], "allow" | "bundle" | "tier">;
  runtimeTools: readonly ToolDescriptor[];
}): string[] {
  if (!canRecoverDeepWorkboardTools(params.executionProfileId)) {
    return [];
  }

  const explicitAllowEntries = params.toolConfig.allow.filter((entry) => {
    const normalized = entry.trim();
    return normalized.length > 0 && !normalized.includes("*") && !normalized.includes("?");
  });
  const restoreAllDeepWorkboardTools =
    params.toolConfig.tier === "advanced" || params.toolConfig.bundle === "workspace-default";
  const selected = new Set<string>();

  for (const tool of params.runtimeTools) {
    if (!isDeepWorkboardTool(tool.id)) {
      continue;
    }
    if (restoreAllDeepWorkboardTools || isToolAllowed(explicitAllowEntries, tool.id)) {
      selected.add(tool.id);
    }
  }

  return [...selected];
}

export async function resolveToolExecutionRuntime(
  deps: TurnPreparationRuntimeDeps,
  ctx: AgentLoadedContext,
  conversation: ConversationRow,
  resolved: {
    message: string;
  },
  executionProfile: ResolvedExecutionProfile,
  opts?: {
    memoryProvenance?: {
      channel?: string;
      threadId?: string;
    };
  },
): Promise<{
  availableTools: ToolDescriptor[];
  toolSetBuilderDeps: ConstructorParameters<typeof ToolSetBuilder>[0];
  toolSetBuilder: ToolSetBuilder;
  filteredTools: ToolDescriptor[];
  toolExecutor: ToolExecutor;
}> {
  const initialToolSetBuilder = new ToolSetBuilder(
    buildToolSetBuilderDeps(deps, conversation, executionProfile.profile, ctx.config.secret_refs),
  );
  const stateMode = resolveGatewayStateMode(deps.opts.container.deploymentConfig);
  const runtimeToolDescriptorSource = await resolveRuntimeToolDescriptorSource({
    ctx,
    mcpManager: deps.mcpManager,
    plugins: deps.plugins,
    stateMode,
    resolvePluginToolExposure: (params) =>
      initialToolSetBuilder.resolvePolicyGatedPluginToolExposure(params),
  });
  const roleToolAllowlist = [
    ...new Set([
      ...executionProfile.profile.tool_allowlist,
      ...resolveExplicitRuntimePluginAllowlist({
        agentAllowlist: ctx.config.tools.allow,
        runtimeTools: runtimeToolDescriptorSource.availableTools,
      }),
      ...resolveExplicitRuntimeWorkboardRecoveryAllowlist({
        executionProfileId: executionProfile.id,
        toolConfig: ctx.config.tools,
        runtimeTools: runtimeToolDescriptorSource.availableTools,
      }),
    ]),
  ];
  const toolSetBuilderDeps = buildToolSetBuilderDeps(
    deps,
    conversation,
    {
      tool_allowlist: roleToolAllowlist,
      tool_denylist: executionProfile.profile.tool_denylist,
    },
    ctx.config.secret_refs,
  );
  const toolSetBuilder = new ToolSetBuilder(toolSetBuilderDeps);
  const toolCandidates = selectToolDirectory(
    resolved.message,
    runtimeToolDescriptorSource.toolAllowlist,
    runtimeToolDescriptorSource.promptSelectableTools,
    Number.POSITIVE_INFINITY,
    stateMode,
  );
  const validatedToolCache = new Map<string, ToolDescriptor | null>();
  const validateTool = (tool: ToolDescriptor): ToolDescriptor | undefined => {
    const cached = validatedToolCache.get(tool.id);
    if (cached !== undefined) {
      return cached ?? undefined;
    }

    const validated = validateToolDescriptorInputSchema(tool);
    if (!validated.ok) {
      deps.opts.container.logger.warn("agent.tool_schema_invalid", {
        tool_id: tool.id,
        error: validated.error,
      });
      validatedToolCache.set(tool.id, null);
      return undefined;
    }

    const normalized = { ...tool, inputSchema: validated.schema };
    validatedToolCache.set(tool.id, normalized);
    return normalized;
  };
  const availableTools = runtimeToolDescriptorSource.availableTools
    .filter((tool) =>
      isToolAllowedWithDenylist(roleToolAllowlist, executionProfile.profile.tool_denylist, tool.id),
    )
    .flatMap((tool) => {
      const validated = validateTool(tool);
      return validated ? [validated] : [];
    });
  const filteredTools = toolCandidates
    .filter((tool) =>
      isToolAllowedWithDenylist(roleToolAllowlist, executionProfile.profile.tool_denylist, tool.id),
    )
    .flatMap((tool) => {
      const validated = validateTool(tool);
      return validated ? [validated] : [];
    });

  const toolExecutor = await createToolExecutorForTurnPreparation({
    deps,
    ctx,
    conversation,
    executionProfile,
    memoryProvenance: opts?.memoryProvenance,
  });

  return { availableTools, toolSetBuilderDeps, toolSetBuilder, filteredTools, toolExecutor };
}

export function buildToolSetBuilderDeps(
  deps: Pick<
    TurnPreparationRuntimeDeps,
    | "home"
    | "opts"
    | "conversationDal"
    | "policyService"
    | "approvalWaitMs"
    | "approvalPollMs"
    | "secretProvider"
    | "plugins"
  >,
  conversation: Pick<ConversationRow, "tenant_id" | "agent_id" | "workspace_id">,
  executionProfile?: Pick<ResolvedExecutionProfile["profile"], "tool_allowlist" | "tool_denylist">,
  secretRefs: ToolSetBuilderDeps["secretRefs"] = [],
): ToolSetBuilderDeps {
  return {
    home: deps.home,
    stateMode: resolveGatewayStateMode(deps.opts.container.deploymentConfig),
    roleToolAllowlist: executionProfile?.tool_allowlist,
    roleToolDenylist: executionProfile?.tool_denylist,
    tenantId: conversation.tenant_id,
    agentId: conversation.agent_id,
    workspaceId: conversation.workspace_id,
    identityScopeDal: deps.opts.container.identityScopeDal,
    conversationDal: deps.conversationDal,
    wsEventDb: deps.opts.container.db,
    policyService: deps.policyService,
    approvalDal: deps.opts.container.approvalDal,
    protocolDeps: deps.opts.protocolDeps,
    approvalWaitMs: deps.approvalWaitMs,
    approvalPollMs: deps.approvalPollMs,
    logger: deps.opts.container.logger,
    secretProvider: deps.secretProvider,
    secretRefs,
    plugins: deps.plugins,
    redactionEngine: deps.opts.container.redactionEngine,
  };
}
