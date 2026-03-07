import type {
  PolicyBundle as PolicyBundleT,
  Decision,
  PolicyDecision as PolicyDecisionT,
  RuleDecision as RuleDecisionT,
} from "@tyrum/schemas";
import { wildcardMatch } from "./wildcard.js";
import type { Logger } from "../observability/logger.js";
import {
  evaluateDomain,
  mostRestrictiveDecision,
  normalizeDomain,
  normalizeUrlForPolicy,
} from "./domain.js";
import { defaultPolicyBundle, loadPolicyBundleFromFile } from "./bundle-loader.js";
import type { PolicySnapshotDal, PolicySnapshotRow } from "./snapshot-dal.js";
import type { PolicyOverrideDal } from "./override-dal.js";
import { sha256HexFromString, stableJsonStringify } from "./canonical-json.js";
import { mergePolicyBundles } from "./bundle-merge.js";
import type { GatewayConfigStore } from "../runtime-state/gateway-config-store.js";
import { fileExists } from "./file-exists.js";

export interface PolicyEvaluation {
  decision: Decision;
  policy_snapshot?: PolicySnapshotRow;
  applied_override_ids?: string[];
  decision_record?: PolicyDecisionT;
}

export class PolicyService {
  private readonly deploymentBundleCache = new Map<
    string,
    { path: string | null; bundle: PolicyBundleT; sha256: string }
  >();
  private readonly agentBundleCache = new Map<
    string,
    { path: string | null; bundle: PolicyBundleT | null; sha256: string | null }
  >();

  constructor(
    private readonly opts: {
      home: string;
      snapshotDal: PolicySnapshotDal;
      overrideDal: PolicyOverrideDal;
      logger?: Logger;
      deploymentPolicy?: {
        enabled?: boolean;
        mode?: string;
        bundlePath?: string;
      };
      includeAgentHomeBundle?: boolean;
      configStore?: GatewayConfigStore;
    },
  ) {}

  isEnabled(): boolean {
    return this.opts.deploymentPolicy?.enabled ?? true;
  }

  isObserveOnly(): boolean {
    const mode = this.opts.deploymentPolicy?.mode?.trim().toLowerCase();
    if (mode === "observe" || mode === "observe-only") return true;
    if (mode === "enforce") return false;
    return false; // default: enforce
  }

  async loadEffectiveBundle(params: {
    playbookBundle?: PolicyBundleT;
    tenantId: string;
    agentId?: string;
  }): Promise<{
    bundle: PolicyBundleT;
    sha256: string;
    sources: { deployment: string; agent: string | null; playbook: "inline" | null };
  }> {
    const tenantId = params.tenantId?.trim();
    if (!tenantId) throw new Error("tenantId is required to load the effective policy bundle");
    const agentId = params.agentId?.trim() || null;
    const deployment = await this.loadDeploymentBundle(tenantId);
    const agent = await this.loadAgentBundle({ tenantId, agentId });
    const playbookBundle = params.playbookBundle;
    const merged = mergePolicyBundles([
      deployment.bundle,
      agent.bundle ?? undefined,
      playbookBundle,
    ]);
    const canonicalJson = stableJsonStringify(merged);
    const sha256 = sha256HexFromString(canonicalJson);

    return {
      bundle: merged,
      sha256,
      sources: {
        deployment: deployment.path ?? "default",
        agent: agent.path,
        playbook: playbookBundle ? "inline" : null,
      },
    };
  }

  async getOrCreateSnapshot(tenantId: string, bundle: PolicyBundleT): Promise<PolicySnapshotRow> {
    return await this.opts.snapshotDal.getOrCreate(tenantId, bundle);
  }

  async evaluateToolCall(params: {
    tenantId: string;
    agentId: string;
    workspaceId?: string;
    toolId: string;
    toolMatchTarget: string;
    url?: string;
    secretScopes?: string[];
    playbookBundle?: PolicyBundleT;
    inputProvenance?: { source: string; trusted: boolean };
  }): Promise<PolicyEvaluation> {
    const effective = await this.loadEffectiveBundle({
      playbookBundle: params.playbookBundle,
      tenantId: params.tenantId,
      agentId: params.agentId,
    });
    const snapshot = await this.getOrCreateSnapshot(params.tenantId, effective.bundle);
    return await this.evaluateToolCallAgainstBundle({
      tenantId: params.tenantId,
      bundle: effective.bundle,
      snapshot,
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      toolId: params.toolId,
      toolMatchTarget: params.toolMatchTarget,
      url: params.url,
      secretScopes: params.secretScopes,
      inputProvenance: params.inputProvenance,
    });
  }

  async evaluateToolCallFromSnapshot(params: {
    tenantId: string;
    policySnapshotId: string;
    agentId: string;
    workspaceId?: string;
    toolId: string;
    toolMatchTarget: string;
    url?: string;
    secretScopes?: string[];
    inputProvenance?: { source: string; trusted: boolean };
  }): Promise<PolicyEvaluation> {
    const snapshot = await this.opts.snapshotDal.getById(params.tenantId, params.policySnapshotId);
    if (!snapshot) {
      const record: PolicyDecisionT = {
        decision: "require_approval",
        rules: [
          {
            rule: "tool_policy",
            outcome: "require_approval",
            detail: `missing policy snapshot: ${params.policySnapshotId}`,
          },
        ],
      };
      return {
        decision: "require_approval",
        policy_snapshot: undefined,
        applied_override_ids: undefined,
        decision_record: record,
      };
    }

    return await this.evaluateToolCallAgainstBundle({
      tenantId: params.tenantId,
      bundle: snapshot.bundle,
      snapshot,
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      toolId: params.toolId,
      toolMatchTarget: params.toolMatchTarget,
      url: params.url,
      secretScopes: params.secretScopes,
      inputProvenance: params.inputProvenance,
    });
  }

  async evaluateSecretsFromSnapshot(params: {
    tenantId: string;
    policySnapshotId: string | null;
    secretScopes: readonly string[];
  }): Promise<PolicyEvaluation> {
    if (params.secretScopes.length === 0) {
      const record: PolicyDecisionT = { decision: "allow", rules: [] };
      return {
        decision: "allow",
        policy_snapshot: undefined,
        applied_override_ids: undefined,
        decision_record: record,
      };
    }

    const id = params.policySnapshotId?.trim() ?? "";
    if (!id) {
      const record: PolicyDecisionT = {
        decision: "require_approval",
        rules: [
          {
            rule: "secrets",
            outcome: "require_approval",
            detail: "missing policy snapshot id",
          },
        ],
      };
      return {
        decision: "require_approval",
        policy_snapshot: undefined,
        applied_override_ids: undefined,
        decision_record: record,
      };
    }

    const snapshot = await this.opts.snapshotDal.getById(params.tenantId, id);
    if (!snapshot) {
      const record: PolicyDecisionT = {
        decision: "require_approval",
        rules: [
          {
            rule: "secrets",
            outcome: "require_approval",
            detail: `missing policy snapshot: ${id}`,
          },
        ],
      };
      return {
        decision: "require_approval",
        policy_snapshot: undefined,
        applied_override_ids: undefined,
        decision_record: record,
      };
    }

    const secretsDomain = normalizeDomain(snapshot.bundle.secrets, "require_approval");

    let decision: Decision = "allow";
    for (const scope of params.secretScopes) {
      decision = mostRestrictiveDecision(decision, evaluateDomain(secretsDomain, scope));
    }

    const decisionRecord: PolicyDecisionT = {
      decision,
      rules: [
        {
          rule: "secrets",
          outcome: decision,
          detail: `scopes=${params.secretScopes.length}`,
        },
      ],
    };

    return {
      decision,
      policy_snapshot: snapshot,
      applied_override_ids: undefined,
      decision_record: decisionRecord,
    };
  }

  private async evaluateToolCallAgainstBundle(params: {
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
  }): Promise<PolicyEvaluation> {
    const toolsDomain = normalizeDomain(params.bundle.tools, "require_approval");
    const egressDomain = normalizeDomain(params.bundle.network_egress, "require_approval");
    const secretsDomain = normalizeDomain(params.bundle.secrets, "require_approval");

    let toolDecision = evaluateDomain(toolsDomain, params.toolId);
    const rules: RuleDecisionT[] = [
      {
        rule: "tool_policy",
        outcome: toolDecision,
        detail: `tool_id=${params.toolId}`,
      },
    ];

    if (
      params.bundle.provenance?.untrusted_shell_requires_approval === true &&
      params.inputProvenance?.trusted === false &&
      params.toolId.trim() === "tool.exec"
    ) {
      toolDecision = mostRestrictiveDecision(toolDecision, "require_approval");
      rules.push({
        rule: "provenance",
        outcome: "require_approval",
        detail: `untrusted_shell_requires_approval=true (source=${params.inputProvenance?.source ?? "unknown"})`,
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
    if (decision === "require_approval" && toolDecision === "require_approval") {
      const overrides = await this.opts.overrideDal.listActiveForTool({
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

  async evaluateConnectorAction(params: {
    tenantId: string;
    agentId: string;
    workspaceId?: string;
    matchTarget: string;
    playbookBundle?: PolicyBundleT;
  }): Promise<PolicyEvaluation> {
    const effective = await this.loadEffectiveBundle({
      playbookBundle: params.playbookBundle,
      tenantId: params.tenantId,
      agentId: params.agentId,
    });
    const snapshot = await this.getOrCreateSnapshot(params.tenantId, effective.bundle);

    const connectorsDomain = normalizeDomain(effective.bundle.connectors, "require_approval");
    let decision = evaluateDomain(connectorsDomain, params.matchTarget);

    const appliedOverrides: string[] = [];
    if (decision === "require_approval") {
      const overrides = await this.opts.overrideDal.listActiveForTool({
        tenantId: params.tenantId,
        agentId: params.agentId,
        workspaceId: params.workspaceId,
        toolId: "connector.send",
      });
      for (const override of overrides) {
        if (wildcardMatch(override.pattern, params.matchTarget)) {
          appliedOverrides.push(override.policy_override_id);
        }
      }
      if (appliedOverrides.length > 0) {
        decision = "allow";
      }
    }

    return {
      decision,
      policy_snapshot: snapshot,
      applied_override_ids: appliedOverrides.length > 0 ? appliedOverrides : undefined,
    };
  }

  async getStatus(scope: { tenantId: string; agentId?: string }): Promise<{
    enabled: boolean;
    observe_only: boolean;
    effective_sha256: string;
    sources: { deployment: string; agent: string | null };
  }> {
    const enabled = this.isEnabled();
    const observeOnly = this.isObserveOnly();

    const tenantId = scope.tenantId?.trim();
    if (!tenantId) throw new Error("tenantId is required to read policy status");
    const effective = await this.loadEffectiveBundle({ tenantId, agentId: scope.agentId });
    return {
      enabled,
      observe_only: observeOnly,
      effective_sha256: effective.sha256,
      sources: {
        deployment: effective.sources.deployment,
        agent: effective.sources.agent,
      },
    };
  }

  private async loadDeploymentBundle(tenantId: string): Promise<{
    path: string | null;
    bundle: PolicyBundleT;
    sha256: string;
  }> {
    const cacheKey = tenantId;
    const path = this.opts.deploymentPolicy?.bundlePath?.trim() || null;
    const fromStore = await this.opts.configStore?.getDeploymentPolicyBundle(tenantId);
    if (fromStore) {
      const entry = {
        path: "shared",
        bundle: fromStore,
        sha256: sha256HexFromString(stableJsonStringify(fromStore)),
      };
      this.deploymentBundleCache.set(cacheKey, entry);
      return entry;
    }
    const cached = this.deploymentBundleCache.get(cacheKey);
    if (cached && cached.path === path) {
      return cached;
    }
    let bundle: PolicyBundleT | null = null;
    if (!bundle && path) {
      try {
        bundle = await loadPolicyBundleFromFile(path);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.opts.logger?.warn("policy.bundle.deployment_load_failed", { path, error: message });
      }
    }
    bundle ??= defaultPolicyBundle();

    const canonicalJson = stableJsonStringify(bundle);
    const sha256 = sha256HexFromString(canonicalJson);
    const entry = { path, bundle, sha256 };
    this.deploymentBundleCache.set(cacheKey, entry);
    return entry;
  }

  private async loadAgentBundle(scope: { tenantId: string; agentId: string | null }): Promise<{
    path: string | null;
    bundle: PolicyBundleT | null;
    sha256: string | null;
  }> {
    const cacheKey = `${scope.tenantId}:${scope.agentId ?? "*"}`;

    if (scope.agentId) {
      const fromStore = await this.opts.configStore?.getAgentPolicyBundle({
        tenantId: scope.tenantId,
        agentId: scope.agentId,
      });
      if (fromStore) {
        const sha256 = sha256HexFromString(stableJsonStringify(fromStore));
        const cached = { path: "shared", bundle: fromStore, sha256 };
        this.agentBundleCache.set(cacheKey, cached);
        return cached;
      }
    }

    if (this.opts.includeAgentHomeBundle === false) {
      const empty = { path: null, bundle: null, sha256: null };
      this.agentBundleCache.set(cacheKey, empty);
      return empty;
    }

    let path: string | null = null;
    for (const candidate of [
      `${this.opts.home}/policy.yml`,
      `${this.opts.home}/policy.yaml`,
      `${this.opts.home}/policy.json`,
    ]) {
      if (await fileExists(candidate)) {
        path = candidate;
        break;
      }
    }

    const cached = this.agentBundleCache.get(cacheKey);
    if (cached && cached.path === path) {
      return cached;
    }

    if (!path) {
      const empty = { path: null, bundle: null, sha256: null };
      this.agentBundleCache.set(cacheKey, empty);
      return empty;
    }

    try {
      const bundle = await loadPolicyBundleFromFile(path);
      const canonicalJson = stableJsonStringify(bundle);
      const sha256 = sha256HexFromString(canonicalJson);
      const loaded = { path, bundle, sha256 };
      this.agentBundleCache.set(cacheKey, loaded);
      return loaded;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.logger?.warn("policy.bundle.agent_load_failed", { path, error: message });
      const empty = { path, bundle: null, sha256: null };
      this.agentBundleCache.set(cacheKey, empty);
      return empty;
    }
  }
}
