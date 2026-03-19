import type { Decision as DecisionT, PolicyBundle as PolicyBundleT } from "@tyrum/contracts";
import { PolicyBundle } from "@tyrum/contracts";
import type { GatewayContainer } from "../../container.js";
import type { LanguageModel } from "ai";
import { AuthProfileDal } from "../models/auth-profile-dal.js";
import { createProviderFromNpm } from "../models/provider-factory.js";
import {
  OAUTH_REFRESH_LEASE_UNAVAILABLE,
  providerRequiresConfiguredAccount,
  resolveProfileSecrets,
  resolveProviderBaseURL,
} from "../agent/runtime/provider-resolution.js";
import {
  evaluateDomain,
  mostRestrictiveDecision,
  normalizeDomain,
  normalizeUrlForPolicy,
} from "../policy/domain.js";
import { resolveBuiltinToolEffect } from "../agent/tools.js";
import { collectSecretHandleIds } from "../secret/collect-secret-handle-ids.js";
import { createSecretHandleResolver } from "../secret/handle-resolver.js";
import type { SecretProvider } from "../secret/provider.js";
import { coerceRecord, coerceStringRecord } from "../util/coerce.js";
import { coerceModelMessages } from "../ai-sdk/message-utils.js";
import {
  parseProviderModelId,
  type ToolApprovalResumeState,
} from "./gateway-step-executor-types.js";

export function extractToolApprovalResumeState(
  context: unknown,
): ToolApprovalResumeState | undefined {
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

export async function loadPolicyBundleFromSnapshot(
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

export async function resolveSecretScopesFromArgs(
  args: unknown,
  secretProvider?: SecretProvider,
): Promise<string[]> {
  const handleIds = collectSecretHandleIds(args);
  if (handleIds.length === 0) return [];
  if (!secretProvider) return handleIds;

  try {
    return await createSecretHandleResolver(secretProvider).resolveScopes(handleIds);
  } catch (err) {
    // Intentional: if the secret provider fails, fall back to handle IDs so the policy
    // engine still sees the secret references (but not resolved values).
    void err;
    return handleIds;
  }
}

export async function evaluateToolCallDecision(input: {
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
  if (policy) {
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
      toolEffect: resolveBuiltinToolEffect(input.toolId),
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

export async function resolveLanguageModel(input: {
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
