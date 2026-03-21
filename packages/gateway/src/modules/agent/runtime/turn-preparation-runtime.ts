import { execFile } from "node:child_process";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  NormalizedContainerKind,
} from "@tyrum/contracts";
import {
  DATA_TAG_SAFETY_PROMPT,
  PROMPT_CONTRACT_PROMPT,
  formatIdentityPrompt,
  formatRuntimePrompt,
  formatSessionContext,
  formatSkillsPrompt,
  formatToolPrompt,
  formatMemoryGuidancePrompt,
  formatWorkOrchestrationPrompt,
} from "./prompts.js";
import {
  ensureDefaultHeartbeatSchedule,
  loadAgentConfigFromDb,
  maybeCleanupSessions,
  type PrepareTurnHelperDeps,
} from "./turn-preparation-helpers.js";
import { type ResolvedAgentTurnInput } from "./turn-helpers.js";
import type { AgentLoadedContext } from "./types.js";
import type { AgentContextStore } from "../context-store.js";
import { loadCurrentAgentContext } from "../load-context.js";
import { resolveEffectiveAgentConfig } from "../../extensions/defaults-dal.js";
import type { SessionRow } from "../session-dal.js";
import type { ToolDescriptor } from "../tools.js";
import { parseChannelSourceKey } from "../../channels/interface.js";
import { applyPersonaToIdentity, resolveAgentPersona } from "../persona.js";
import type { McpManager } from "../mcp-manager.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "@tyrum/runtime-policy";
export {
  buildToolSetBuilderDeps,
  canPatternMatchMcpToolId,
  resolveToolExecutionRuntime,
} from "./turn-preparation-runtime-tool-resolution.js";

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
  const memoryGuidanceText = formatMemoryGuidancePrompt(filteredTools, {
    isAutomationTurn: automation !== null && automation !== undefined,
  });
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
    memoryGuidanceText: memoryGuidanceText
      ? `Durable memory guidance:\n${memoryGuidanceText}`
      : undefined,
    sessionText,
    preTurnTexts: [...preTurnTexts],
    automationDirectiveText,
    automationContextText,
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
