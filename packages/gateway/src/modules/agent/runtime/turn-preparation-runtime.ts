import { execFile } from "node:child_process";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  NormalizedContainerKind,
} from "@tyrum/schemas";
import {
  DATA_TAG_SAFETY_PROMPT,
  formatIdentityPrompt,
  formatRuntimePrompt,
  formatSessionContext,
  formatSkillsPrompt,
  formatToolPrompt,
} from "./prompts.js";
import {
  ensureDefaultHeartbeatSchedule,
  loadAgentConfigFromDb,
  maybeCleanupSessions,
  semanticSearch,
  type PrepareTurnHelperDeps,
} from "./turn-preparation-helpers.js";
import {
  isStatusQuery,
  parseIntakeModeDecision,
  type ResolvedAgentTurnInput,
} from "./turn-helpers.js";
import type { ResolvedExecutionProfile } from "./intake-delegation.js";
import type { AgentLoadedContext } from "./types.js";
import type { AgentContextStore } from "../context-store.js";
import { loadCurrentAgentContext } from "../load-context.js";
import type { SessionRow } from "../session-dal.js";
import { isToolAllowed, selectToolDirectory, type ToolDescriptor } from "../tools.js";
import { tagContent } from "../provenance.js";
import { sanitizeForModel } from "../sanitizer.js";
import { parseChannelSourceKey } from "../../channels/interface.js";
import { MemoryV1Dal } from "../../memory/v1-dal.js";
import { buildMemoryV1Digest } from "../../memory/v1-digest.js";
import { resolveGatewayStateMode } from "../../runtime-state/mode.js";
import { applyPersonaToIdentity, resolveAgentPersona } from "../persona.js";
import { ToolSetBuilder } from "./tool-set-builder.js";
import type { McpManager } from "../mcp-manager.js";
import type { ApprovalNotifier } from "../../approval/notifier.js";
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
  approvalNotifier: ApprovalNotifier;
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
  approvalWorkflowAvailable: boolean;
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
  memoryDigestResult: { digest: string },
  filteredTools: readonly ToolDescriptor[],
  automation: AutomationPromptInput | null | undefined,
  runtimePrompt: string,
) {
  const sessionCtx = formatSessionContext(session.summary, session.transcript);
  const identityPrompt = formatIdentityPrompt(ctx.identity);
  const skillsText = `Enabled skills:\n${formatSkillsPrompt(ctx.skills)}`;
  const toolsText = `Available tools:\n${formatToolPrompt(filteredTools)}`;
  const sessionText = `Session context:\n${sessionCtx}`;
  const memoryTagged = tagContent(memoryDigestResult.digest, "memory", false);
  const memoryText = `Memory digest:\n${sanitizeForModel(memoryTagged)}`;
  const automationTriggerText = automation
    ? `Automation trigger:\n${[
        `Schedule kind: ${automation.schedule_kind ?? "unknown"}`,
        `Schedule id: ${automation.schedule_id ?? "unknown"}`,
        `Fired at: ${automation.fired_at ?? "unknown"}`,
        `Previous fired at: ${automation.previous_fired_at ?? "never"}`,
        `Delivery mode: ${automation.delivery_mode ?? "notify"}`,
        automation.instruction ? `Instruction: ${automation.instruction}` : undefined,
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n")}`
    : undefined;

  return {
    identityPrompt,
    runtimePrompt,
    safetyPrompt: DATA_TAG_SAFETY_PROMPT,
    skillsText,
    toolsText,
    sessionText,
    memoryText,
    automationTriggerText,
  };
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
  const loaded = await loadCurrentAgentContext({
    contextStore: deps.contextStore,
    tenantId: deps.tenantId,
    agentId,
    workspaceId,
    config,
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
  memoryDigestResult: {
    digest: string;
    included_item_ids: string[];
    keyword_hit_count: number;
    semantic_hit_count: number;
    structured_item_count: number;
  };
  toolSetBuilder: ToolSetBuilder;
  filteredTools: ToolDescriptor[];
}> {
  const wantsMcpTools = ctx.config.tools.allow.some(
    (entry) => entry === "*" || entry === "mcp*" || entry.startsWith("mcp."),
  );
  const memoryDigestPromise =
    isStatusQuery(resolved.message) || parseIntakeModeDecision(resolved.message)
      ? Promise.resolve({
          digest: "Skipped for command turns.",
          included_item_ids: [],
          keyword_hit_count: 0,
          semantic_hit_count: 0,
          structured_item_count: 0,
        })
      : buildMemoryDigest(deps, ctx, session, resolved);

  const [memoryDigestResult, mcpTools] = await Promise.all([
    memoryDigestPromise,
    wantsMcpTools
      ? deps.mcpManager.listToolDescriptors(ctx.mcpServers)
      : deps.mcpManager.listToolDescriptors([]),
  ]);
  const toolSetBuilder = new ToolSetBuilder({
    home: deps.home,
    stateMode: resolveGatewayStateMode(deps.opts.container.deploymentConfig),
    tenantId: session.tenant_id,
    agentId: session.agent_id,
    workspaceId: session.workspace_id,
    sessionDal: deps.sessionDal,
    wsEventDb: deps.opts.container.db,
    policyService: deps.policyService,
    approvalDal: deps.opts.container.approvalDal,
    approvalNotifier: deps.approvalNotifier as { notify: (approval: unknown) => void },
    approvalWaitMs: deps.approvalWaitMs,
    approvalPollMs: deps.approvalPollMs,
    logger: deps.opts.container.logger,
    secretProvider: deps.secretProvider,
    plugins: deps.plugins,
    redactionEngine: deps.opts.container.redactionEngine,
  });
  const pluginToolsRaw = deps.plugins?.getToolDescriptors() ?? [];
  const { allowlist: toolAllowlist, pluginTools } =
    await toolSetBuilder.resolvePolicyGatedPluginToolExposure({
      allowlist: ctx.config.tools.allow,
      pluginTools: pluginToolsRaw,
    });
  const toolCandidates = selectToolDirectory(
    resolved.message,
    toolAllowlist,
    [...mcpTools, ...pluginTools],
    Number.POSITIVE_INFINITY,
    true,
    resolveGatewayStateMode(deps.opts.container.deploymentConfig),
  );
  const filteredTools = toolCandidates
    .filter((tool) => isToolAllowed(executionProfile.profile.tool_allowlist, tool.id))
    .filter((tool) => ctx.config.memory.v1.enabled || !tool.id.startsWith("memory."))
    .slice(0, 8);

  return { memoryDigestResult, toolSetBuilder, filteredTools };
}

async function buildMemoryDigest(
  deps: TurnPreparationRuntimeDeps,
  ctx: AgentLoadedContext,
  session: SessionRow,
  resolved: ResolvedAgentTurnInput,
): Promise<{
  digest: string;
  included_item_ids: string[];
  keyword_hit_count: number;
  semantic_hit_count: number;
  structured_item_count: number;
}> {
  try {
    return await buildMemoryV1Digest({
      dal: new MemoryV1Dal(deps.opts.container.db),
      tenantId: session.tenant_id,
      agentId: session.agent_id,
      query: resolved.message,
      config: ctx.config.memory.v1,
      semanticSearch: ctx.config.memory.v1.semantic.enabled
        ? (query, limit) =>
            semanticSearch(
              deps,
              query,
              limit,
              ctx.config.model.model,
              session.session_id,
              session.tenant_id,
              session.agent_id,
            )
        : undefined,
    });
  } catch (error) {
    deps.opts.container.logger.warn("memory.v1.digest_failed", {
      session_id: session.session_id,
      agent_id: session.agent_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      digest: "Memory digest unavailable.",
      included_item_ids: [],
      keyword_hit_count: 0,
      semantic_hit_count: 0,
      structured_item_count: 0,
    };
  }
}
