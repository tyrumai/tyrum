import { execFile } from "node:child_process";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  NormalizedContainerKind,
} from "@tyrum/schemas";
import {
  DATA_TAG_SAFETY_PROMPT,
  PROMPT_CONTRACT_PROMPT,
  formatIdentityPrompt,
  formatRuntimePrompt,
  formatSessionContext,
  formatSkillsPrompt,
  formatToolPrompt,
  formatWorkOrchestrationPrompt,
} from "./prompts.js";
import {
  ensureDefaultHeartbeatSchedule,
  loadAgentConfigFromDb,
  maybeCleanupSessions,
  type PrepareTurnHelperDeps,
} from "./turn-preparation-helpers.js";
import { type ResolvedAgentTurnInput } from "./turn-helpers.js";
import type { ResolvedExecutionProfile } from "./intake-delegation.js";
import type { AgentLoadedContext } from "./types.js";
import type { AgentContextStore } from "../context-store.js";
import { materializeAllowedAgentIds } from "../access-config.js";
import { loadCurrentAgentContext } from "../load-context.js";
import { resolveEffectiveAgentConfig } from "../../extensions/defaults-dal.js";
import type { SessionRow } from "../session-dal.js";
import {
  isToolAllowed,
  isToolAllowedWithDenylist,
  isBuiltinToolAvailableInStateMode,
  listBuiltinToolDescriptors,
  selectToolDirectory,
  type ToolDescriptor,
} from "../tools.js";
import { validateToolDescriptorInputSchema } from "../tool-schema.js";
import { parseChannelSourceKey } from "../../channels/interface.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";
import { applyPersonaToIdentity, resolveAgentPersona } from "../persona.js";
import { ToolSetBuilder } from "./tool-set-builder.js";
import type { ToolSetBuilderDeps } from "./tool-set-builder.js";
import type { McpManager } from "../mcp-manager.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "../../policy/service.js";

export interface TurnPreparationRuntimeDeps extends PrepareTurnHelperDeps {
  home: string;
  contextStore: AgentContextStore;
  agentId: string;
  workspaceId: string;
  mcpManager: McpManager;
  plugins: PluginRegistry | undefined;
  policyService: PolicyService;
  approvalWaitMs: number;
  approvalPollMs: number;
}

const GIT_ROOT_CACHE_TTL_MS = 60_000;
const MAX_GIT_ROOT_CACHE_ENTRIES = 64;

interface GitRootCacheEntry {
  expiresAtMs: number;
  value: Promise<string | undefined>;
}

const gitRootByHome = new Map<string, GitRootCacheEntry>();

function evictOldestGitRootCacheEntry(): void {
  const oldestKey = gitRootByHome.keys().next().value;
  if (typeof oldestKey === "string") {
    gitRootByHome.delete(oldestKey);
  }
}

function resolveGitRootProcess(home: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", home, "rev-parse", "--show-toplevel"],
      {
        encoding: "utf-8",
        maxBuffer: 16 * 1024,
      },
      (error, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        const value = stdout.trim();
        resolve(value.length > 0 ? value : undefined);
      },
    );
  });
}

export function resetGitRootCacheForTests(): void {
  gitRootByHome.clear();
}

export async function resolveGitRoot(cwd: string): Promise<string | undefined> {
  const home = cwd.trim();
  if (!home) return undefined;

  const cached = gitRootByHome.get(home);
  const now = Date.now();
  if (cached && cached.expiresAtMs > now) {
    return await cached.value;
  }
  gitRootByHome.delete(home);

  if (gitRootByHome.size >= MAX_GIT_ROOT_CACHE_ENTRIES) {
    evictOldestGitRootCacheEntry();
  }

  const gitRoot = resolveGitRootProcess(home).catch(() => undefined);
  gitRootByHome.set(home, {
    expiresAtMs: now + GIT_ROOT_CACHE_TTL_MS,
    value: gitRoot,
  });

  return await gitRoot;
}

export async function buildRuntimePrompt(input: {
  nowIso: string;
  agentId: string;
  workspaceId: string;
  sessionId: string;
  channel: string;
  threadId: string;
  home: string;
  stateMode: "local" | "shared";
  model: string;
}): Promise<string> {
  return formatRuntimePrompt({
    ...input,
    cwd: process.cwd(),
    shell: process.env["SHELL"]?.trim() || "unknown",
    gitRoot: await resolveGitRoot(input.home),
  });
}

type AutomationPromptInput = {
  schedule_kind?: string | null;
  schedule_id?: string | null;
  fired_at?: string | null;
  previous_fired_at?: string | null;
  delivery_mode?: string | null;
  instruction?: string | null;
};

export function assemblePrompts(
  ctx: AgentLoadedContext,
  session: SessionRow,
  filteredTools: readonly ToolDescriptor[],
  preTurnTexts: readonly string[],
  automation: AutomationPromptInput | null | undefined,
  runtimePrompt: string,
) {
  const sessionCtx = formatSessionContext(session.context_state);
  const identityPrompt = formatIdentityPrompt(ctx.identity);
  const promptContractPrompt = PROMPT_CONTRACT_PROMPT;
  const skillsText = `Skill guidance:\n${formatSkillsPrompt(ctx.skills)}`;
  const workOrchestrationText = formatWorkOrchestrationPrompt(filteredTools);
  const toolsText = `Tool contracts:\n${formatToolPrompt(filteredTools)}`;
  const sessionText = `Session state:\n${sessionCtx.trim() || "No stored session state."}`;
  const automationDirectiveText =
    automation?.instruction && automation.instruction.trim().length > 0
      ? `Automation directive:\n${automation.instruction.trim()}`
      : undefined;
  const automationContextText = automation
    ? `Automation context:\n${[
        `Schedule kind: ${automation.schedule_kind ?? "unknown"}`,
        `Schedule id: ${automation.schedule_id ?? "unknown"}`,
        `Fired at: ${automation.fired_at ?? "unknown"}`,
        `Previous fired at: ${automation.previous_fired_at ?? "never"}`,
        `Delivery mode: ${automation.delivery_mode ?? "notify"}`,
      ].join("\n")}`
    : undefined;

  return {
    identityPrompt,
    promptContractPrompt,
    runtimePrompt,
    safetyPrompt: DATA_TAG_SAFETY_PROMPT,
    skillsText,
    toolsText,
    workOrchestrationText: workOrchestrationText
      ? `Work orchestration guidance:\n${workOrchestrationText}`
      : undefined,
    sessionText,
    preTurnTexts: [...preTurnTexts],
    automationDirectiveText,
    automationContextText,
  };
}

function canDiscoverMcpTools(toolConfig: AgentLoadedContext["config"]["tools"]): boolean {
  if (toolConfig.default_mode === "allow") {
    return true;
  }

  return toolConfig.allow.some((entry) => {
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

export async function resolveIdentityAndContext(
  deps: TurnPreparationRuntimeDeps,
  input: AgentTurnRequestT,
  resolved: ResolvedAgentTurnInput,
): Promise<{
  agentKey: string;
  workspaceKey: string;
  ctx: AgentLoadedContext;
  containerKind: NormalizedContainerKind;
  connectorKey: string;
  accountKey: string;
}> {
  const agentKey = input.agent_key?.trim() || deps.agentId;
  const workspaceKey = input.workspace_key?.trim() || deps.workspaceId;

  const agentId = await deps.opts.container.identityScopeDal.ensureAgentId(deps.tenantId, agentKey);
  const workspaceId = await deps.opts.container.identityScopeDal.ensureWorkspaceId(
    deps.tenantId,
    workspaceKey,
  );
  await deps.opts.container.identityScopeDal.ensureMembership(deps.tenantId, agentId, workspaceId);
  await ensureDefaultHeartbeatSchedule(deps, agentId, workspaceId);

  const config = await loadAgentConfigFromDb(deps, {
    tenantId: deps.tenantId,
    agentId,
    agentKey,
  });
  const effectiveConfig = await resolveEffectiveAgentConfig({
    db: deps.opts.container.db,
    tenantId: deps.tenantId,
    config,
  });
  const loaded = await loadCurrentAgentContext({
    contextStore: deps.contextStore,
    tenantId: deps.tenantId,
    agentId,
    workspaceId,
    config: effectiveConfig,
  });
  const persona = resolveAgentPersona({
    agentKey,
    config: loaded.config,
    identity: loaded.identity,
  });
  const ctx = {
    ...loaded,
    identity: applyPersonaToIdentity(loaded.identity, persona),
  };
  maybeCleanupSessions(deps, ctx.config.sessions.ttl_days, agentKey);

  const containerKind: NormalizedContainerKind =
    input.container_kind ?? resolved.envelope?.container.kind ?? "channel";
  const parsedChannel = parseChannelSourceKey(resolved.channel);
  return {
    agentKey,
    workspaceKey,
    ctx,
    containerKind,
    connectorKey: parsedChannel.connector,
    accountKey: resolved.envelope?.delivery.account ?? parsedChannel.accountId,
  };
}

export async function resolveToolsAndMemory(
  deps: TurnPreparationRuntimeDeps,
  ctx: AgentLoadedContext,
  session: SessionRow,
  resolved: ResolvedAgentTurnInput,
  executionProfile: ResolvedExecutionProfile,
): Promise<{
  availableTools: ToolDescriptor[];
  toolSetBuilderDeps: ConstructorParameters<typeof ToolSetBuilder>[0];
  toolSetBuilder: ToolSetBuilder;
  filteredTools: ToolDescriptor[];
}> {
  const mcpTools = canDiscoverMcpTools(ctx.config.tools)
    ? await deps.mcpManager.listToolDescriptors(ctx.mcpServers)
    : [];
  const toolSetBuilderDeps = buildToolSetBuilderDeps(deps, session, executionProfile.profile);
  const toolSetBuilder = new ToolSetBuilder(toolSetBuilderDeps);
  const builtinTools = listBuiltinToolDescriptors();
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
    [...mcpTools, ...pluginTools],
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

  return { availableTools, toolSetBuilderDeps, toolSetBuilder, filteredTools };
}

export function buildToolSetBuilderDeps(
  deps: Pick<
    TurnPreparationRuntimeDeps,
    | "home"
    | "opts"
    | "sessionDal"
    | "policyService"
    | "approvalWaitMs"
    | "approvalPollMs"
    | "secretProvider"
    | "plugins"
  >,
  session: Pick<SessionRow, "tenant_id" | "agent_id" | "workspace_id">,
  executionProfile?: Pick<ResolvedExecutionProfile["profile"], "tool_allowlist" | "tool_denylist">,
): ToolSetBuilderDeps {
  return {
    home: deps.home,
    stateMode: resolveGatewayStateMode(deps.opts.container.deploymentConfig),
    roleToolAllowlist: executionProfile?.tool_allowlist,
    roleToolDenylist: executionProfile?.tool_denylist,
    tenantId: session.tenant_id,
    agentId: session.agent_id,
    workspaceId: session.workspace_id,
    sessionDal: deps.sessionDal,
    wsEventDb: deps.opts.container.db,
    policyService: deps.policyService,
    approvalDal: deps.opts.container.approvalDal,
    protocolDeps: deps.opts.protocolDeps,
    approvalWaitMs: deps.approvalWaitMs,
    approvalPollMs: deps.approvalPollMs,
    logger: deps.opts.container.logger,
    secretProvider: deps.secretProvider,
    plugins: deps.plugins,
    redactionEngine: deps.opts.container.redactionEngine,
  };
}
