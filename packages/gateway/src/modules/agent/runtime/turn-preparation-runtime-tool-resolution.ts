import type { ConversationRow } from "../conversation-dal.js";
import { materializeAllowedAgentIds } from "../access-config.js";
import {
  isToolAllowed,
  isToolAllowedWithDenylist,
  isBuiltinToolAvailableInStateMode,
  listBuiltinToolDescriptors,
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
import { buildSecretClipboardToolDescriptor } from "../tool-secret-definitions.js";
import { createToolExecutorForTurnPreparation } from "./turn-preparation-runtime-tooling.js";
import type { ToolExecutor } from "../tool-executor.js";

function canDiscoverMcpTools(toolConfig: AgentLoadedContext["config"]["tools"]): boolean {
  if (toolConfig.default_mode === "allow") {
    return true;
  }

  return toolConfig.allow.some((entry: string) => {
    const normalized = entry.trim();
    return (
      normalized === "*" || normalized.startsWith("mcp.") || canPatternMatchMcpToolId(normalized)
    );
  });
}

const MCP_TOOL_SHAPE_CHARS = ["m", "c", "p", ".", "x"] as const;
const MCP_TOOL_ACCEPTING_STATE = 7;

function nextMcpToolShapeState(state: number, char: string): number | undefined {
  switch (state) {
    case 0:
      return char === "m" ? 1 : undefined;
    case 1:
      return char === "c" ? 2 : undefined;
    case 2:
      return char === "p" ? 3 : undefined;
    case 3:
      return char === "." ? 4 : undefined;
    case 4:
      return char === "." ? undefined : 5;
    case 5:
      return char === "." ? 6 : 5;
    case 6:
      return char === "." ? undefined : 7;
    case 7:
      return 7;
    default:
      return undefined;
  }
}

export function canPatternMatchMcpToolId(pattern: string): boolean {
  const normalized = pattern.trim();
  if (normalized.length === 0) {
    return false;
  }

  // Match against the structural language mcp.<server>.<tool...> instead of a single sample id.
  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const visit = (patternIndex: number, shapeState: number): boolean => {
    const key = `${String(patternIndex)}:${String(shapeState)}`;
    const cached = memo.get(key);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(key)) {
      return false;
    }

    if (patternIndex >= normalized.length) {
      const matches = shapeState === MCP_TOOL_ACCEPTING_STATE;
      memo.set(key, matches);
      return matches;
    }

    const token = normalized[patternIndex];
    if (token === undefined) {
      memo.set(key, false);
      return false;
    }

    visiting.add(key);
    let matches = false;
    if (token === "*") {
      matches = visit(patternIndex + 1, shapeState);
      if (!matches) {
        matches = MCP_TOOL_SHAPE_CHARS.some((char) => {
          const nextState = nextMcpToolShapeState(shapeState, char);
          return nextState !== undefined && visit(patternIndex, nextState);
        });
      }
    } else if (token === "?") {
      matches = MCP_TOOL_SHAPE_CHARS.some((char) => {
        const nextState = nextMcpToolShapeState(shapeState, char);
        return nextState !== undefined && visit(patternIndex + 1, nextState);
      });
    } else {
      const nextState = nextMcpToolShapeState(shapeState, token);
      matches = nextState !== undefined && visit(patternIndex + 1, nextState);
    }

    visiting.delete(key);
    memo.set(key, matches);
    return matches;
  };

  return visit(0, 0);
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
  const mcpTools = canDiscoverMcpTools(ctx.config.tools)
    ? await deps.mcpManager.listToolDescriptors(ctx.mcpServers)
    : [];
  const toolSetBuilderDeps = buildToolSetBuilderDeps(
    deps,
    conversation,
    executionProfile.profile,
    ctx.config.secret_refs,
  );
  const toolSetBuilder = new ToolSetBuilder(toolSetBuilderDeps);
  const dynamicBuiltinTools = [buildSecretClipboardToolDescriptor(ctx.config.secret_refs)].filter(
    (tool): tool is ToolDescriptor => tool !== undefined,
  );
  const builtinTools = [...listBuiltinToolDescriptors(), ...dynamicBuiltinTools];
  const pluginToolsRaw: ToolDescriptor[] = [];
  for (const tool of deps.plugins?.getToolDescriptors() ?? []) {
    const id = tool.id.trim();
    if (!id) {
      continue;
    }
    if (id === tool.id) {
      pluginToolsRaw.push(tool);
      continue;
    }
    pluginToolsRaw.push({
      id,
      description: tool.description,
      effect: tool.effect,
      keywords: tool.keywords,
      inputSchema: tool.inputSchema,
      source: tool.source,
      family: tool.family,
      backingServerId: tool.backingServerId,
    });
  }
  const baseToolAllowlist = materializeAllowedAgentIds(ctx.config.tools, [
    ...builtinTools,
    ...mcpTools,
    ...pluginToolsRaw,
  ]).map((tool) => tool.id);
  const { allowlist: toolAllowlist, pluginTools } =
    toolSetBuilder.resolvePolicyGatedPluginToolExposure({
      allowlist: baseToolAllowlist,
      pluginTools: pluginToolsRaw,
    });
  const stateMode = resolveGatewayStateMode(deps.opts.container.deploymentConfig);
  const toolCandidates = selectToolDirectory(
    resolved.message,
    toolAllowlist,
    [...mcpTools, ...pluginTools, ...dynamicBuiltinTools],
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
  const availableTools = [
    ...builtinTools.filter(
      (tool) =>
        isBuiltinToolAvailableInStateMode(tool.id, stateMode) &&
        isToolAllowed(toolAllowlist, tool.id),
    ),
    ...mcpTools,
    ...pluginTools,
  ]
    .filter((tool) =>
      isToolAllowedWithDenylist(
        executionProfile.profile.tool_allowlist,
        executionProfile.profile.tool_denylist,
        tool.id,
      ),
    )
    .flatMap((tool) => {
      const validated = validateTool(tool);
      return validated ? [validated] : [];
    });
  const filteredTools = toolCandidates
    .filter((tool) =>
      isToolAllowedWithDenylist(
        executionProfile.profile.tool_allowlist,
        executionProfile.profile.tool_denylist,
        tool.id,
      ),
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
