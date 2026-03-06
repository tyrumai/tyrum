import type {
  ActionPrimitive as ActionPrimitiveT,
  AttemptCost as AttemptCostT,
  Decision as DecisionT,
  PolicyBundle as PolicyBundleT,
  SecretHandle as SecretHandleT,
} from "@tyrum/schemas";
import { PolicyBundle } from "@tyrum/schemas";
import type { GatewayContainer } from "../../container.js";
import { AuthProfileDal } from "../models/auth-profile-dal.js";
import { createProviderFromNpm } from "../models/provider-factory.js";
import {
  OAUTH_REFRESH_LEASE_UNAVAILABLE,
  providerRequiresConfiguredAccount,
  resolveProfileSecrets,
  resolveProviderBaseURL,
} from "../agent/runtime/provider-resolution.js";
import type { StepExecutionContext, StepExecutor, StepResult } from "./engine.js";
import {
  parsePlaybookOutputContract,
  resolveMaxOutputBytes,
  validateJsonAgainstSchema,
} from "./playbook-output-contract.js";
import {
  appendToolApprovalResponseMessage,
  coerceModelMessages,
  countAssistantMessages,
  hasToolResult,
} from "../ai-sdk/message-utils.js";
import { generateText, jsonSchema, stepCountIs, tool as aiTool } from "ai";
import type { LanguageModel, ModelMessage, Tool, ToolExecutionOptions, ToolSet } from "ai";
import { canonicalizeToolMatchTarget } from "../policy/match-target.js";
import {
  evaluateDomain,
  mostRestrictiveDecision,
  normalizeDomain,
  normalizeUrlForPolicy,
} from "../policy/domain.js";
import { collectSecretHandleIds } from "../secret/collect-secret-handle-ids.js";
import type { SecretProvider } from "../secret/provider.js";
import { coerceRecord, coerceStringRecord } from "../util/coerce.js";
import { acquireWorkspaceLease, releaseWorkspaceLease } from "../workspace/lease.js";
const DEFAULT_TOOL_APPROVAL_WAIT_MS = 120_000;

const SUPPORTED_LLM_TOOL_IDS = new Set<string>(["tool.exec", "tool.http.fetch"]);

type ToolBudgetState = {
  toolCallsUsed: number;
  countedToolCallIds: Set<string>;
  limitExceededError?: string;
};

function parseProviderModelId(model: string): { providerId: string; modelId: string } {
  const trimmed = model.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash >= trimmed.length - 1) {
    throw new Error(`invalid model '${model}' (expected provider/model)`);
  }
  return { providerId: trimmed.slice(0, slash), modelId: trimmed.slice(slash + 1) };
}

function maybeTruncateText(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (maxBytes <= 0) return { text: "", truncated: true };
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return { text, truncated: false };
  const sliced = bytes.subarray(0, maxBytes);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return { text: decoder.decode(sliced), truncated: true };
}

function deriveAgentIdFromKey(key: string): string {
  if (!key.startsWith("agent:")) return "default";
  const parts = key.split(":");
  const agentId = parts.length > 1 ? parts[1] : undefined;
  const trimmed = agentId?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "default";
}

type ToolApprovalResumeState = {
  approval_id: string;
  messages: ModelMessage[];
  steps_used?: number;
  tool_calls_used?: number;
  counted_tool_call_ids?: string[];
};

function extractToolApprovalResumeState(context: unknown): ToolApprovalResumeState | undefined {
  const record = coerceRecord(context);
  if (!record) return undefined;
  if (record["source"] !== "llm-step-tool-execution") return undefined;
  const ai = coerceRecord(record["ai_sdk"]);
  if (!ai) return undefined;
  const approvalId = typeof ai["approval_id"] === "string" ? ai["approval_id"].trim() : "";
  if (approvalId.length === 0) return undefined;
  const messages = coerceModelMessages(ai["messages"]);
  if (!messages) return undefined;

  const stepsUsedRaw = ai["steps_used"];
  const stepsUsed =
    typeof stepsUsedRaw === "number" &&
    Number.isFinite(stepsUsedRaw) &&
    Number.isSafeInteger(stepsUsedRaw) &&
    stepsUsedRaw >= 0
      ? stepsUsedRaw
      : undefined;

  const toolCallsUsedRaw = ai["tool_calls_used"];
  const toolCallsUsed =
    typeof toolCallsUsedRaw === "number" &&
    Number.isFinite(toolCallsUsedRaw) &&
    Number.isSafeInteger(toolCallsUsedRaw) &&
    toolCallsUsedRaw >= 0
      ? toolCallsUsedRaw
      : undefined;

  const countedToolCallIdsRaw = ai["counted_tool_call_ids"];
  const countedToolCallIds = Array.isArray(countedToolCallIdsRaw)
    ? countedToolCallIdsRaw.filter((value): value is string => typeof value === "string")
    : undefined;

  return {
    approval_id: approvalId,
    messages,
    steps_used: stepsUsed,
    tool_calls_used: toolCallsUsed,
    counted_tool_call_ids: countedToolCallIds,
  };
}

async function loadPolicyBundleFromSnapshot(
  container: GatewayContainer,
  policySnapshotId: string,
): Promise<PolicyBundleT | undefined> {
  const row = await container.db.get<{ bundle_json: string }>(
    "SELECT bundle_json FROM policy_snapshots WHERE policy_snapshot_id = ?",
    [policySnapshotId],
  );
  if (!row?.bundle_json) return undefined;
  try {
    return PolicyBundle.parse(JSON.parse(row.bundle_json) as unknown);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    container.logger?.warn("execution.policy_snapshot_invalid", {
      policy_snapshot_id: policySnapshotId,
      error: message,
    });
    return undefined;
  }
}

async function resolveSecretScopesFromArgs(
  args: unknown,
  secretProvider?: SecretProvider,
): Promise<string[]> {
  const handleIds = collectSecretHandleIds(args);
  if (handleIds.length === 0) return [];
  if (!secretProvider) return handleIds;

  let handles: SecretHandleT[];
  try {
    handles = await secretProvider.list();
  } catch (err) {
    // Intentional: if the secret provider fails, fall back to handle IDs so the policy
    // engine still sees the secret references (but not resolved values).
    void err;
    return handleIds;
  }

  const out: string[] = [];
  for (const id of handleIds) {
    const handle = handles.find((h) => h.handle_id === id);
    if (handle?.scope) {
      out.push(`${handle.provider}:${handle.scope}`);
    } else {
      out.push(id);
    }
  }
  return out;
}

async function evaluateToolCallDecision(input: {
  container: GatewayContainer;
  tenantId: string;
  policySnapshotId: string;
  agentId: string;
  workspaceId: string;
  toolId: string;
  toolMatchTarget: string;
  url?: string;
  secretScopes: readonly string[];
}): Promise<DecisionT> {
  const policy = input.container.policyService;
  if (policy?.isEnabled()) {
    const evaluation = await policy.evaluateToolCallFromSnapshot({
      tenantId: input.tenantId,
      policySnapshotId: input.policySnapshotId,
      agentId: input.agentId,
      workspaceId: input.workspaceId,
      toolId: input.toolId,
      toolMatchTarget: input.toolMatchTarget,
      url: input.url,
      secretScopes: input.secretScopes.length > 0 ? [...input.secretScopes] : undefined,
      inputProvenance: { source: "workflow", trusted: true },
    });
    return policy.isObserveOnly() ? "allow" : evaluation.decision;
  }

  const bundle = await loadPolicyBundleFromSnapshot(input.container, input.policySnapshotId);
  if (!bundle) return "require_approval";

  const toolsDomain = normalizeDomain(bundle.tools, "require_approval");
  const egressDomain = normalizeDomain(bundle.network_egress, "require_approval");
  const secretsDomain = normalizeDomain(bundle.secrets, "require_approval");

  let decision = evaluateDomain(toolsDomain, input.toolId);
  if (input.url) {
    const normalizedUrl = normalizeUrlForPolicy(input.url);
    if (normalizedUrl.length > 0) {
      decision = mostRestrictiveDecision(decision, evaluateDomain(egressDomain, normalizedUrl));
    }
  }
  if (input.secretScopes.length > 0) {
    let secretsDecision: DecisionT = "allow";
    for (const scope of input.secretScopes) {
      secretsDecision = mostRestrictiveDecision(
        secretsDecision,
        evaluateDomain(secretsDomain, scope),
      );
    }
    decision = mostRestrictiveDecision(decision, secretsDecision);
  }

  return decision;
}

async function resolveLanguageModel(input: {
  container: GatewayContainer;
  tenantId: string;
  secretProvider?: SecretProvider;
  model: string;
}): Promise<{ model: LanguageModel; providerId: string; modelId: string }> {
  const parsed = parseProviderModelId(input.model);
  const loaded = await input.container.modelCatalog.getEffectiveCatalog({
    tenantId: input.tenantId,
  });
  const provider = loaded.catalog[parsed.providerId];
  if (!provider) {
    throw new Error(`provider not found in models.dev catalog: ${parsed.providerId}`);
  }
  const providerEnabled = (provider as { enabled?: boolean }).enabled ?? true;
  if (!providerEnabled) {
    throw new Error(`provider '${parsed.providerId}' is disabled`);
  }
  const modelEntry = provider.models?.[parsed.modelId];
  if (!modelEntry) {
    throw new Error(
      `model not found in models.dev catalog: ${parsed.providerId}/${parsed.modelId}`,
    );
  }
  const modelEnabled = (modelEntry as { enabled?: boolean }).enabled ?? true;
  if (!modelEnabled) {
    throw new Error(`model '${parsed.providerId}/${parsed.modelId}' is disabled`);
  }

  const providerOverride = (modelEntry as { provider?: { npm?: string; api?: string } }).provider;
  const npm = providerOverride?.npm ?? provider.npm;
  const api = providerOverride?.api ?? provider.api;
  if (!npm) {
    throw new Error(`provider npm package missing for ${parsed.providerId}/${parsed.modelId}`);
  }

  const authProfiles = await new AuthProfileDal(input.container.db).list({
    tenantId: input.tenantId,
    providerKey: parsed.providerId,
    status: "active",
  });

  let selectedProfile: (typeof authProfiles)[number] | undefined;
  let selectedSecrets: Record<string, string> | undefined;
  for (const profile of authProfiles) {
    const resolved = await resolveProfileSecrets(profile, {
      tenantId: input.tenantId,
      secretProvider: input.secretProvider,
      oauthProviderRegistry: input.container.oauthProviderRegistry,
      oauthRefreshLeaseDal: input.container.oauthRefreshLeaseDal,
      oauthLeaseOwner: `execution-${parsed.providerId}`,
      logger: input.container.logger,
      fetchImpl: fetch,
    });
    if (!resolved || resolved === OAUTH_REFRESH_LEASE_UNAVAILABLE) continue;
    selectedProfile = profile;
    selectedSecrets = resolved;
    break;
  }

  const requiresConfiguredAccount = providerRequiresConfiguredAccount({
    providerApi: api,
    providerEnv: (provider as { env?: unknown }).env,
  });
  if (!selectedProfile && requiresConfiguredAccount) {
    throw new Error(
      `no active auth profiles with credentials configured for provider '${parsed.providerId}'`,
    );
  }

  const providerOptions = coerceRecord((provider as { options?: unknown }).options) ?? {};
  const modelOptions = coerceRecord((modelEntry as { options?: unknown }).options) ?? {};
  const mergedOptions = Object.assign({}, providerOptions, modelOptions);

  const providerHeaders = coerceStringRecord((provider as { headers?: unknown }).headers) ?? {};
  const modelHeaders = coerceStringRecord((modelEntry as { headers?: unknown }).headers) ?? {};
  const optionHeaders = coerceStringRecord(mergedOptions["headers"]) ?? {};
  const headers =
    Object.keys(providerHeaders).length > 0 ||
    Object.keys(modelHeaders).length > 0 ||
    Object.keys(optionHeaders).length > 0
      ? { ...providerHeaders, ...modelHeaders, ...optionHeaders }
      : undefined;

  const profileConfig =
    selectedProfile?.config && typeof selectedProfile.config === "object"
      ? (selectedProfile.config as Record<string, unknown>)
      : undefined;
  const apiKey =
    selectedSecrets?.["api_key"] ??
    selectedSecrets?.["token"] ??
    selectedSecrets?.["access_token"] ??
    undefined;
  const baseURL = resolveProviderBaseURL({
    providerApi: api,
    options: mergedOptions,
    config: profileConfig,
    secrets: selectedSecrets,
  });

  const providerImpl = createProviderFromNpm({
    npm,
    providerId: parsed.providerId,
    apiKey,
    baseURL,
    headers,
    options: mergedOptions,
    fetchImpl: fetch,
    config: profileConfig,
    secrets: selectedSecrets,
  });

  const raw = providerImpl.languageModel(parsed.modelId);
  if (typeof raw === "string") {
    throw new Error(
      `provider returned string model id for '${parsed.providerId}/${parsed.modelId}'`,
    );
  }

  return { model: raw as LanguageModel, providerId: parsed.providerId, modelId: parsed.modelId };
}

type ToolCallPolicyState = {
  toolId: string;
  toolCallId: string;
  args: unknown;
  matchTarget: string;
  decision: DecisionT;
  shouldRequireApproval: boolean;
};

function buildToolSet(input: {
  planId: string;
  stepIndex: number;
  timeoutMs: number;
  allowedToolIds: readonly string[];
  maxToolCalls: number;
  toolExecutor: StepExecutor;
  toolBudget: ToolBudgetState;
  executionContext: StepExecutionContext;
  container: GatewayContainer;
  secretProvider?: SecretProvider;
  toolCallPolicyStates: Map<string, ToolCallPolicyState>;
}): ToolSet {
  const allowed = new Set(input.allowedToolIds);
  const tools: Record<string, Tool> = {};

  const accountToolCall = (toolCallId: string): void => {
    const id = toolCallId.trim();
    if (id.length === 0) return;
    if (input.toolBudget.countedToolCallIds.has(id)) return;

    input.toolBudget.countedToolCallIds.add(id);
    input.toolBudget.toolCallsUsed += 1;
    if (input.toolBudget.toolCallsUsed > input.maxToolCalls) {
      const message = `tool-call limit exceeded (max=${String(input.maxToolCalls)})`;
      input.toolBudget.limitExceededError = message;
      throw new Error(message);
    }
  };

  let cachedApproval:
    | { status: string; context: unknown; reason?: string | null }
    | null
    | undefined;
  const loadApproval = async (): Promise<typeof cachedApproval> => {
    if (cachedApproval !== undefined) return cachedApproval;
    const approvalId = input.executionContext.approvalId;
    if (!approvalId) {
      cachedApproval = null;
      return cachedApproval;
    }
    const row = await input.container.db.get<{
      status: string;
      context_json: string;
      resolution_json: string | null;
    }>(
      "SELECT status, context_json, resolution_json FROM approvals WHERE tenant_id = ? AND approval_id = ?",
      [input.executionContext.tenantId, approvalId],
    );
    if (!row) {
      cachedApproval = null;
      return cachedApproval;
    }
    let context: unknown = {};
    try {
      context = JSON.parse(row.context_json) as unknown;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      input.container.logger?.warn("execution.approval_context_parse_failed", {
        approval_id: approvalId,
        error: message,
      });
      context = {};
    }
    const resolution = row.resolution_json
      ? ((): { reason?: string } | undefined => {
          try {
            return JSON.parse(row.resolution_json) as { reason?: string };
          } catch {
            return undefined;
          }
        })()
      : undefined;
    cachedApproval = { status: row.status, context, reason: resolution?.reason ?? null };
    return cachedApproval;
  };

  const resolveToolCallPolicyState = async (input2: {
    toolId: string;
    toolCallId: string;
    args: unknown;
  }): Promise<ToolCallPolicyState> => {
    const existing = input.toolCallPolicyStates.get(input2.toolCallId);
    if (existing && existing.toolId === input2.toolId) {
      return existing;
    }

    const matchTarget = canonicalizeToolMatchTarget(input2.toolId, input2.args, undefined);
    const policySnapshotId = input.executionContext.policySnapshotId;
    const url =
      input2.toolId === "tool.http.fetch"
        ? (() => {
            const rec = coerceRecord(input2.args) ?? {};
            return typeof rec["url"] === "string" ? rec["url"] : undefined;
          })()
        : undefined;
    const secretScopes = policySnapshotId
      ? await resolveSecretScopesFromArgs(input2.args, input.secretProvider)
      : [];

    const decision = policySnapshotId
      ? await evaluateToolCallDecision({
          container: input.container,
          tenantId: input.executionContext.tenantId,
          policySnapshotId,
          agentId: deriveAgentIdFromKey(input.executionContext.key),
          workspaceId: input.executionContext.workspaceId,
          toolId: input2.toolId,
          toolMatchTarget: matchTarget,
          url,
          secretScopes,
        })
      : ("allow" as const);

    const shouldRequireApproval = decision === "require_approval";

    const state: ToolCallPolicyState = {
      toolId: input2.toolId,
      toolCallId: input2.toolCallId,
      args: input2.args,
      matchTarget,
      decision,
      shouldRequireApproval,
    };

    input.toolCallPolicyStates.set(input2.toolCallId, state);
    return state;
  };

  const runTool = async (action: ActionPrimitiveT, toolCallId: string): Promise<unknown> => {
    const startedAtMs = Date.now();
    const totalBudgetMs = Math.max(1, input.timeoutMs);
    const needsWorkspaceLease = action.type === "CLI";
    const workspaceLeaseOwner = `llm-step:${input.executionContext.attemptId}:${toolCallId}`;

    if (needsWorkspaceLease) {
      const acquired = await acquireWorkspaceLease(input.container.db, {
        tenantId: input.executionContext.tenantId,
        workspaceId: input.executionContext.workspaceId,
        owner: workspaceLeaseOwner,
        ttlMs: Math.max(30_000, totalBudgetMs + 10_000),
        waitMs: totalBudgetMs,
      });
      if (!acquired) {
        throw new Error("workspace is busy");
      }
    }

    const waitedMs = Math.max(0, Date.now() - startedAtMs);
    const remainingMs = Math.max(1, totalBudgetMs - waitedMs);

    try {
      const res = await input.toolExecutor.execute(
        action,
        input.planId,
        input.stepIndex,
        remainingMs,
        input.executionContext,
      );
      if (!res.success) {
        throw new Error(res.error || "tool execution failed");
      }
      return res.result ?? res.evidence ?? null;
    } finally {
      if (needsWorkspaceLease) {
        await releaseWorkspaceLease(input.container.db, {
          tenantId: input.executionContext.tenantId,
          workspaceId: input.executionContext.workspaceId,
          owner: workspaceLeaseOwner,
        }).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          input.container.logger.warn("execution.workspace_lease_release_failed", {
            workspace_id: input.executionContext.workspaceId,
            owner: workspaceLeaseOwner,
            error: message,
          });
        });
      }
    }
  };

  const matchesApprovedToolContext = (input2: {
    context: unknown;
    toolId: string;
    toolCallId: string;
    toolMatchTarget: string;
  }): boolean => {
    const ctx = coerceRecord(input2.context);
    return (
      ctx?.["source"] === "llm-step-tool-execution" &&
      ctx["tool_id"] === input2.toolId &&
      ctx["tool_call_id"] === input2.toolCallId &&
      ctx["tool_match_target"] === input2.toolMatchTarget
    );
  };

  const parseTimeoutMsArg = (record: Record<string, unknown>): number | undefined => {
    const raw = record["timeout_ms"];
    if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
    return Math.max(1, Math.floor(raw));
  };

  const resolveToolCallId = (options: ToolExecutionOptions): string =>
    typeof options.toolCallId === "string" && options.toolCallId.trim().length > 0
      ? options.toolCallId.trim()
      : "tc-unknown";

  const createPolicyAwareTool = (input2: {
    toolId: "tool.exec" | "tool.http.fetch";
    description: string;
    inputSchema: Record<string, unknown>;
    toAction: (args: Record<string, unknown>) => ActionPrimitiveT;
  }): Tool =>
    aiTool({
      description: input2.description,
      inputSchema: jsonSchema(input2.inputSchema),
      needsApproval: async (
        args: unknown,
        options: { toolCallId: string; messages: ModelMessage[]; experimental_context?: unknown },
      ): Promise<boolean> => {
        accountToolCall(options.toolCallId);
        const state = await resolveToolCallPolicyState({
          toolId: input2.toolId,
          toolCallId: options.toolCallId,
          args,
        });

        if (!state.shouldRequireApproval) {
          return false;
        }

        const approval = await loadApproval();
        if (approval && approval.status !== "pending") {
          const matches = matchesApprovedToolContext({
            context: approval.context,
            toolId: input2.toolId,
            toolCallId: options.toolCallId,
            toolMatchTarget: state.matchTarget,
          });
          if (matches && !hasToolResult(options.messages, options.toolCallId)) {
            return false;
          }
        }

        return true;
      },
      execute: async (args: unknown, options: ToolExecutionOptions) => {
        const toolCallId = resolveToolCallId(options);

        accountToolCall(toolCallId);
        const state = await resolveToolCallPolicyState({
          toolId: input2.toolId,
          toolCallId,
          args,
        });

        if (state.decision === "deny") {
          throw new Error(`policy denied tool execution for '${input2.toolId}'`);
        }

        if (state.shouldRequireApproval) {
          const approval = await loadApproval();
          const approved = approval?.status === "approved";
          const matches = matchesApprovedToolContext({
            context: approval?.context,
            toolId: input2.toolId,
            toolCallId,
            toolMatchTarget: state.matchTarget,
          });
          if (!approved || !matches) {
            throw new Error(`tool execution not approved for '${input2.toolId}'`);
          }
        }

        const record = coerceRecord(args) ?? {};
        return await runTool(input2.toAction(record), toolCallId);
      },
    });

  if (allowed.has("tool.exec")) {
    tools["tool.exec"] = createPolicyAwareTool({
      toolId: "tool.exec",
      description: "Execute a shell command in the workspace sandbox.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string" },
          timeout_ms: { type: "number" },
        },
        required: ["command"],
        additionalProperties: true,
      },
      toAction: (record) => {
        const command = typeof record["command"] === "string" ? record["command"] : "";
        const cwd = typeof record["cwd"] === "string" ? record["cwd"] : undefined;
        const timeoutMs = parseTimeoutMsArg(record);

        return {
          type: "CLI",
          args: {
            cmd: "sh",
            args: ["-c", command],
            ...(cwd ? { cwd } : undefined),
            ...(timeoutMs ? { timeout_ms: timeoutMs } : undefined),
          },
        };
      },
    });
  }

  if (allowed.has("tool.http.fetch")) {
    tools["tool.http.fetch"] = createPolicyAwareTool({
      toolId: "tool.http.fetch",
      description: "Fetch an HTTP URL (SSRF protected, output capped).",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          method: { type: "string" },
          headers: { type: "object" },
          body: { type: "string" },
          timeout_ms: { type: "number" },
        },
        required: ["url"],
        additionalProperties: true,
      },
      toAction: (record) => {
        const url = typeof record["url"] === "string" ? record["url"] : "";
        const method = typeof record["method"] === "string" ? record["method"] : undefined;
        const headers = coerceRecord(record["headers"]);
        const body = typeof record["body"] === "string" ? record["body"] : undefined;
        const timeoutMs = parseTimeoutMsArg(record);

        return {
          type: "Http",
          args: {
            url,
            ...(method ? { method } : undefined),
            ...(headers ? { headers } : undefined),
            ...(body ? { body } : undefined),
            ...(timeoutMs ? { timeout_ms: timeoutMs } : undefined),
          },
        };
      },
    });
  }

  return tools;
}

function extractToolErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim().length > 0) return err;
  try {
    return JSON.stringify(err);
  } catch (stringifyErr) {
    // Intentional: JSON.stringify can throw on circular structures.
    void stringifyErr;
    return String(err);
  }
}

async function executeLlmAction(input: {
  action: ActionPrimitiveT;
  planId: string;
  stepIndex: number;
  timeoutMs: number;
  container: GatewayContainer;
  toolExecutor: StepExecutor;
  executionContext: StepExecutionContext;
  secretProvider?: SecretProvider;
  languageModelOverride?: LanguageModel;
}): Promise<StepResult> {
  const startedAt = Date.now();

  const args = coerceRecord(input.action.args) ?? {};
  const modelIdRaw = typeof args["model"] === "string" ? args["model"].trim() : "";
  const prompt = typeof args["prompt"] === "string" ? args["prompt"] : "";
  const maxToolCallsRaw = args["max_tool_calls"];
  const maxToolCalls =
    typeof maxToolCallsRaw === "number" && Number.isFinite(maxToolCallsRaw) && maxToolCallsRaw >= 0
      ? Math.floor(maxToolCallsRaw)
      : 0;

  const toolsObj = coerceRecord(args["tools"]);
  const rawAllowedToolIds = toolsObj?.["allow"];
  const allowedToolIds = Array.isArray(rawAllowedToolIds)
    ? rawAllowedToolIds.filter((v): v is string => typeof v === "string")
    : [];

  const outputContract = parsePlaybookOutputContract(args);
  if (!outputContract || outputContract.kind !== "json") {
    return {
      success: false,
      error: "Output contract violated: llm steps must declare JSON output",
    };
  }

  if (!modelIdRaw) {
    return { success: false, error: "missing required argument: model" };
  }
  if (!prompt.trim()) {
    return { success: false, error: "missing required argument: prompt" };
  }

  for (const toolId of allowedToolIds) {
    if (!SUPPORTED_LLM_TOOL_IDS.has(toolId)) {
      return { success: false, error: `unsupported tool id in allowlist: ${toolId}` };
    }
  }

  const modelResolved = input.languageModelOverride
    ? { model: input.languageModelOverride, providerId: "override", modelId: "override" }
    : await resolveLanguageModel({
        container: input.container,
        tenantId: input.executionContext.tenantId,
        secretProvider: input.secretProvider,
        model: modelIdRaw,
      });

  const toolBudget: ToolBudgetState = { toolCallsUsed: 0, countedToolCallIds: new Set<string>() };
  const toolCallPolicyStates = new Map<string, ToolCallPolicyState>();
  let stepsUsedSoFar = 0;
  let messages: ModelMessage[] = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: prompt }],
    },
  ];

  const buildCost = (usage2?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }): AttemptCostT => {
    const durationMs = Math.max(0, Date.now() - startedAt);
    return {
      duration_ms: durationMs,
      input_tokens: usage2?.inputTokens,
      output_tokens: usage2?.outputTokens,
      total_tokens: usage2?.totalTokens,
      model: modelResolved.modelId,
      provider: modelResolved.providerId,
    };
  };

  const stepApprovalId = input.executionContext.approvalId;
  if (stepApprovalId) {
    const row = await input.container.db.get<{
      status: string;
      context_json: string;
      resolution_json: string | null;
    }>(
      "SELECT status, context_json, resolution_json FROM approvals WHERE tenant_id = ? AND approval_id = ?",
      [input.executionContext.tenantId, stepApprovalId],
    );
    if (row && row.status !== "pending") {
      let approvalContext: unknown = {};
      try {
        approvalContext = JSON.parse(row.context_json) as unknown;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        input.container.logger?.warn("execution.approval_context_parse_failed", {
          approval_id: stepApprovalId,
          error: message,
        });
        approvalContext = {};
      }

      const resumeState = extractToolApprovalResumeState(approvalContext);
      if (resumeState) {
        stepsUsedSoFar = resumeState.steps_used ?? countAssistantMessages(resumeState.messages);
        if (resumeState.tool_calls_used !== undefined) {
          toolBudget.toolCallsUsed = resumeState.tool_calls_used;
        }
        if (resumeState.counted_tool_call_ids) {
          toolBudget.countedToolCallIds = new Set<string>(resumeState.counted_tool_call_ids);
        }

        messages = appendToolApprovalResponseMessage(resumeState.messages, {
          approvalId: resumeState.approval_id,
          approved: row.status === "approved",
          reason: (() => {
            if (row.resolution_json) {
              try {
                const parsed = JSON.parse(row.resolution_json) as unknown;
                if (parsed && typeof parsed === "object" && "reason" in parsed) {
                  const reason = (parsed as { reason?: unknown }).reason;
                  if (typeof reason === "string" && reason.trim().length > 0) return reason.trim();
                }
              } catch {
                // ignore
              }
            }
            return row.status === "expired"
              ? "approval expired"
              : row.status === "cancelled"
                ? "approval cancelled"
                : undefined;
          })(),
        });
      }
    }
  }

  const toolSet = buildToolSet({
    planId: input.planId,
    stepIndex: input.stepIndex,
    timeoutMs: input.timeoutMs,
    allowedToolIds,
    maxToolCalls,
    toolExecutor: input.toolExecutor,
    toolBudget,
    executionContext: input.executionContext,
    container: input.container,
    secretProvider: input.secretProvider,
    toolCallPolicyStates,
  });

  const maxStepsTotal = maxToolCalls <= 0 ? 1 : Math.max(3, maxToolCalls * 2 + 3);
  const remainingSteps = maxStepsTotal - stepsUsedSoFar;
  if (remainingSteps <= 0) {
    return { success: false, error: "No assistant response returned.", cost: buildCost() };
  }

  let resultText: string;
  let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
  let stepsUsedAfterCall = stepsUsedSoFar;
  let responseMessages: ModelMessage[] = [];
  let approvalRequest:
    | { approvalId: string; toolCallId: string; toolName: string; toolArgs?: unknown }
    | undefined;
  let toolError: { toolName: string; message: string } | undefined;
  try {
    const res = await generateText({
      model: modelResolved.model as unknown as LanguageModel,
      system: [
        "You are executing an LLM step inside a deterministic playbook.",
        "Return ONLY valid JSON.",
      ].join("\n"),
      messages,
      tools: toolSet,
      stopWhen: [() => toolBudget.limitExceededError !== undefined, stepCountIs(remainingSteps)],
      timeout: input.timeoutMs,
    });

    resultText = (res.text ?? "").trim();
    usage = {
      inputTokens: res.totalUsage?.inputTokens,
      outputTokens: res.totalUsage?.outputTokens,
      totalTokens: res.totalUsage?.totalTokens,
    };
    responseMessages = (res.response?.messages ?? []) as unknown as ModelMessage[];

    stepsUsedAfterCall = stepsUsedSoFar + (res.steps?.length ?? 0);

    if (res.steps) {
      const lastStep = res.steps.at(-1);
      const approvalPart = lastStep?.content.find(
        (part) => coerceRecord(part)?.["type"] === "tool-approval-request",
      );
      if (approvalPart) {
        const record = coerceRecord(approvalPart);
        const approvalId =
          typeof record?.["approvalId"] === "string" ? record["approvalId"].trim() : "";
        const toolCall = coerceRecord(record?.["toolCall"]);

        const toolCallId =
          typeof toolCall?.["toolCallId"] === "string" ? toolCall["toolCallId"].trim() : "";
        const toolName =
          typeof toolCall?.["toolName"] === "string" ? toolCall["toolName"].trim() : "";
        const toolArgs = toolCall ? toolCall["input"] : undefined;

        if (!approvalId || !toolCallId || !toolName) {
          throw new Error("tool approval request missing required fields");
        }

        approvalRequest = { approvalId, toolCallId, toolName, toolArgs };
      }
    }

    if (res.steps) {
      for (const step of res.steps) {
        for (const part of step.content) {
          if (part.type !== "tool-error") continue;
          toolError = {
            toolName: String(part.toolName),
            message: extractToolErrorMessage(part.error),
          };
          break;
        }
        if (toolError) break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, cost: buildCost(usage) };
  }

  if (toolBudget.limitExceededError) {
    return { success: false, error: toolBudget.limitExceededError, cost: buildCost(usage) };
  }

  if (toolError) {
    return {
      success: false,
      error: `Tool execution failed: ${toolError.toolName} (${toolError.message})`,
      cost: buildCost(usage),
    };
  }

  if (approvalRequest) {
    const policyState = toolCallPolicyStates.get(approvalRequest.toolCallId);
    if (!policyState) {
      return {
        success: false,
        error: `tool approval request missing policy state for tool_call_id=${approvalRequest.toolCallId}`,
        cost: buildCost(usage),
      };
    }

    const expiresAt = new Date(Date.now() + DEFAULT_TOOL_APPROVAL_WAIT_MS).toISOString();

    return {
      success: true,
      pause: {
        kind: "policy",
        prompt: `Approve execution of '${policyState.toolId}'`,
        detail: `approval required for tool '${policyState.toolId}'`,
        expiresAt,
        context: {
          source: "llm-step-tool-execution",
          tool_id: policyState.toolId,
          tool_call_id: policyState.toolCallId,
          tool_match_target: policyState.matchTarget,
          ai_sdk: {
            approval_id: approvalRequest.approvalId,
            messages: [...messages, ...responseMessages],
            steps_used: stepsUsedAfterCall,
            tool_calls_used: toolBudget.toolCallsUsed,
            counted_tool_call_ids: Array.from(toolBudget.countedToolCallIds),
          },
        },
      },
      cost: buildCost(usage),
    };
  }

  if (!resultText) {
    return { success: false, error: "No assistant response returned.", cost: buildCost(usage) };
  }

  const maxOutputBytes = resolveMaxOutputBytes(args);
  const capped = maybeTruncateText(resultText, maxOutputBytes);
  if (capped.truncated) {
    return {
      success: false,
      error: "Output contract violated: model output was truncated",
      cost: buildCost(usage),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText) as unknown;
  } catch (err) {
    // Intentional: output contract violation is returned as a structured StepResult.
    void err;
    return {
      success: false,
      error: "Output contract violated: expected JSON model output",
      cost: buildCost(usage),
    };
  }

  if (outputContract.schema !== undefined) {
    const schemaError = validateJsonAgainstSchema(parsed, outputContract.schema);
    if (schemaError) {
      return {
        success: false,
        error: `Output contract violated: model output failed schema validation (${schemaError})`,
        evidence: { json: parsed },
        cost: buildCost(usage),
      };
    }
  }

  const cost = buildCost(usage);

  const resultPayload = {
    ok: true,
    type: input.action.type,
    model: modelIdRaw,
    tool_calls_allowed: maxToolCalls,
  };

  return { success: true, result: resultPayload, evidence: { json: parsed }, cost };
}

export function createGatewayStepExecutor(input: {
  container: GatewayContainer;
  toolExecutor: StepExecutor;
  /** Optional LanguageModel override (primarily for tests). */
  languageModel?: LanguageModel;
}): StepExecutor {
  return {
    execute: async (
      action: ActionPrimitiveT,
      planId: string,
      stepIndex: number,
      timeoutMs: number,
      context: StepExecutionContext,
    ): Promise<StepResult> => {
      if (action.type === "Llm") {
        return await executeLlmAction({
          action,
          planId,
          stepIndex,
          timeoutMs,
          container: input.container,
          toolExecutor: input.toolExecutor,
          executionContext: context,
          languageModelOverride: input.languageModel,
        });
      }

      return await input.toolExecutor.execute(action, planId, stepIndex, timeoutMs, context);
    },
  };
}
