import type {
  Decision,
  PolicyBundle as PolicyBundleT,
  PolicyDecision as PolicyDecisionT,
  RuleDecision as RuleDecisionT,
} from "@tyrum/contracts";
import {
  evaluateDomain,
  mostRestrictiveDecision,
  normalizeDomain,
  normalizeUrlForPolicy,
} from "./domain.js";
import type { PolicyOverrideStore, PolicySnapshotRow } from "./ports.js";
import { wildcardMatch } from "./wildcard.js";

export type ToolEffect = "read_only" | "state_changing";

export async function evaluateToolCallAgainstBundle(params: {
  tenantId: string;
  bundle: PolicyBundleT;
  snapshot: PolicySnapshotRow;
  agentId: string;
  workspaceId?: string;
  toolId: string;
  toolMatchTarget: string;
  url?: string;
  secretScopes?: string[];
  inputProvenance?: { source: string; trusted: boolean };
  toolEffect?: ToolEffect;
  roleAllowed?: boolean;
  overrideStore: Pick<PolicyOverrideStore, "listActiveForTool">;
}): Promise<{
  decision: Decision;
  policy_snapshot?: PolicySnapshotRow;
  applied_override_ids?: string[];
  decision_record?: PolicyDecisionT;
}> {
  const toolsDomain = normalizeDomain(params.bundle.tools, "require_approval");
  const egressDomain = normalizeDomain(params.bundle.network_egress, "require_approval");
  const secretsDomain = normalizeDomain(params.bundle.secrets, "require_approval");

  const explicitToolDecision = evaluateToolDecisionOverride(toolsDomain, params.toolId);
  let toolDecision: Decision;
  const rules: RuleDecisionT[] = [];

  if (params.roleAllowed === false) {
    toolDecision = "deny";
    rules.push({
      rule: "tool_policy",
      outcome: "deny",
      detail: `tool_id=${params.toolId};source=role_ceiling`,
    });
  } else {
    const implicitToolDecision = resolveImplicitToolDecision({
      toolId: params.toolId,
      toolEffect: params.toolEffect,
      toolsDomain,
    });
    toolDecision = explicitToolDecision ?? implicitToolDecision.decision;
    rules.push({
      rule: "tool_policy",
      outcome: toolDecision,
      detail:
        explicitToolDecision === undefined
          ? `tool_id=${params.toolId};default=${implicitToolDecision.source}`
          : `tool_id=${params.toolId};source=explicit_rule`,
    });
  }

  if (
    params.bundle.provenance?.untrusted_shell_requires_approval === true &&
    params.inputProvenance?.trusted === false &&
    params.toolId.trim() === "bash"
  ) {
    toolDecision = mostRestrictiveDecision(toolDecision, "require_approval");
    rules.push({
      rule: "provenance",
      outcome: "require_approval",
      detail: `untrusted_shell_requires_approval=true (source=${params.inputProvenance.source})`,
    });
  }

  let egressDecision: Decision = "allow";
  if (params.url) {
    const normalizedUrl = normalizeUrlForPolicy(params.url);
    if (normalizedUrl.length > 0) {
      egressDecision = evaluateDomain(egressDomain, normalizedUrl);
      rules.push({
        rule: "network_egress",
        outcome: egressDecision,
        detail: normalizedUrl,
      });
    }
  }

  let secretsDecision: Decision = "allow";
  if (params.secretScopes && params.secretScopes.length > 0) {
    let decision: Decision = "allow";
    for (const scope of params.secretScopes) {
      decision = mostRestrictiveDecision(decision, evaluateDomain(secretsDomain, scope));
    }
    secretsDecision = decision;
    rules.push({
      rule: "secrets",
      outcome: secretsDecision,
      detail: `scopes=${params.secretScopes.length}`,
    });
  }

  let decision = mostRestrictiveDecision(
    toolDecision,
    mostRestrictiveDecision(egressDecision, secretsDecision),
  );

  const appliedOverrides: string[] = [];
  if (
    params.roleAllowed !== false &&
    decision === "require_approval" &&
    toolDecision === "require_approval"
  ) {
    const overrides = await params.overrideStore.listActiveForTool({
      tenantId: params.tenantId,
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      toolId: params.toolId,
    });
    for (const override of overrides) {
      if (wildcardMatch(override.pattern, params.toolMatchTarget)) {
        appliedOverrides.push(override.policy_override_id);
      }
    }
    if (appliedOverrides.length > 0) {
      toolDecision = "allow";
      decision = mostRestrictiveDecision(
        toolDecision,
        mostRestrictiveDecision(egressDecision, secretsDecision),
      );
      rules.push({
        rule: "policy_override",
        outcome: "allow",
        detail: `applied_overrides=${appliedOverrides.join(",")}`,
      });
    }
  }

  const decisionRecord: PolicyDecisionT = { decision, rules };

  return {
    decision,
    policy_snapshot: params.snapshot,
    applied_override_ids: appliedOverrides.length > 0 ? appliedOverrides : undefined,
    decision_record: decisionRecord,
  };
}

function evaluateToolDecisionOverride(
  domain: ReturnType<typeof normalizeDomain>,
  matchTarget: string,
): Decision | undefined {
  const target = matchTarget.trim();

  for (const pattern of domain.deny) {
    if (wildcardMatch(pattern, target)) return "deny";
  }
  for (const pattern of domain.require_approval) {
    if (wildcardMatch(pattern, target)) return "require_approval";
  }
  for (const pattern of domain.allow) {
    if (wildcardMatch(pattern, target)) return "allow";
  }

  return undefined;
}

function resolveImplicitToolDecision(input: {
  toolId: string;
  toolEffect?: ToolEffect;
  toolsDomain: ReturnType<typeof normalizeDomain>;
}): { decision: Decision; source: string } {
  if (input.toolEffect === "read_only") {
    return { decision: "allow", source: "read_only" };
  }

  if (input.toolEffect === "state_changing") {
    if (isDefaultAllowedStateChangingTool(input.toolId)) {
      return { decision: "allow", source: "mcp_memory_write" };
    }
    return { decision: "require_approval", source: "state_changing" };
  }

  return {
    decision: evaluateDomain(input.toolsDomain, input.toolId),
    source: "bundle",
  };
}

function isDefaultAllowedStateChangingTool(toolId: string): boolean {
  return toolId.trim() === "mcp.memory.write";
}
