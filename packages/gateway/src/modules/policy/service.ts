import type {
  PolicyBundle as PolicyBundleT,
  Decision,
  PolicyDecision as PolicyDecisionT,
  RuleDecision as RuleDecisionT,
} from "@tyrum/schemas";
import { PolicyBundle } from "@tyrum/schemas";
import { access } from "node:fs/promises";
import { wildcardMatch } from "./wildcard.js";
import type { Logger } from "../observability/logger.js";
import {
  evaluateDomain,
  mostRestrictiveDecision,
  normalizeDomain,
  normalizeUrlForPolicy,
  type PolicyDomainConfig,
} from "./domain.js";
import { defaultPolicyBundle, loadPolicyBundleFromFile } from "./bundle-loader.js";
import type { PolicySnapshotDal, PolicySnapshotRow } from "./snapshot-dal.js";
import type { PolicyOverrideDal } from "./override-dal.js";
import { sha256HexFromString, stableJsonStringify } from "./canonical-json.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    // Intentional: treat missing policy files as absent.
    return false;
  }
}

function unionStrings(a: readonly string[], b: readonly string[]): string[] {
  if (a.length === 0) return [...b];
  if (b.length === 0) return [...a];
  return [...new Set([...a, ...b])];
}

function mergeDomain(
  domains: Array<PolicyDomainConfig | undefined>,
  fallbackDefault: Decision,
): PolicyDomainConfig {
  let defaultDecision: Decision = fallbackDefault;
  let allow: string[] = [];
  let requireApproval: string[] = [];
  let deny: string[] = [];

  for (const domain of domains) {
    if (!domain) continue;
    defaultDecision = mostRestrictiveDecision(defaultDecision, domain.default);
    allow = unionStrings(allow, domain.allow);
    requireApproval = unionStrings(requireApproval, domain.require_approval);
    deny = unionStrings(deny, domain.deny);
  }

  return {
    default: defaultDecision,
    allow,
    require_approval: requireApproval,
    deny,
  };
}

export interface PolicyEvaluation {
  decision: Decision;
  policy_snapshot?: PolicySnapshotRow;
  applied_override_ids?: string[];
  decision_record?: PolicyDecisionT;
}

export class PolicyService {
  private deploymentBundleCache:
    | { path: string | null; bundle: PolicyBundleT; sha256: string }
    | undefined;
  private agentBundleCache:
    | { path: string | null; bundle: PolicyBundleT | null; sha256: string | null }
    | undefined;

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

  async loadEffectiveBundle(params?: { playbookBundle?: PolicyBundleT }): Promise<{
    bundle: PolicyBundleT;
    sha256: string;
    sources: { deployment: string; agent: string | null; playbook: "inline" | null };
  }> {
    const deployment = await this.loadDeploymentBundle();
    const agent = await this.loadAgentBundle();
    const playbookBundle = params?.playbookBundle;

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
    const effective = await this.loadEffectiveBundle({ playbookBundle: params.playbookBundle });
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
    const effective = await this.loadEffectiveBundle({ playbookBundle: params.playbookBundle });
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

  async getStatus(): Promise<{
    enabled: boolean;
    observe_only: boolean;
    effective_sha256: string;
    sources: { deployment: string; agent: string | null };
  }> {
    const enabled = this.isEnabled();
    const observeOnly = this.isObserveOnly();

    const effective = await this.loadEffectiveBundle();
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

  private async loadDeploymentBundle(): Promise<{
    path: string | null;
    bundle: PolicyBundleT;
    sha256: string;
  }> {
    const path = this.opts.deploymentPolicy?.bundlePath?.trim() || null;
    if (this.deploymentBundleCache && this.deploymentBundleCache.path === path) {
      return this.deploymentBundleCache;
    }

    let bundle: PolicyBundleT;
    if (path) {
      try {
        bundle = await loadPolicyBundleFromFile(path);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.opts.logger?.warn("policy.bundle.deployment_load_failed", { path, error: message });
        bundle = defaultPolicyBundle();
      }
    } else {
      bundle = defaultPolicyBundle();
    }

    const canonicalJson = stableJsonStringify(bundle);
    const sha256 = sha256HexFromString(canonicalJson);
    this.deploymentBundleCache = { path, bundle, sha256 };
    return this.deploymentBundleCache;
  }

  private async loadAgentBundle(): Promise<{
    path: string | null;
    bundle: PolicyBundleT | null;
    sha256: string | null;
  }> {
    const candidates = [
      `${this.opts.home}/policy.yml`,
      `${this.opts.home}/policy.yaml`,
      `${this.opts.home}/policy.json`,
    ];

    let path: string | null = null;
    for (const candidate of candidates) {
      if (await fileExists(candidate)) {
        path = candidate;
        break;
      }
    }

    if (this.agentBundleCache && this.agentBundleCache.path === path) {
      return this.agentBundleCache;
    }

    if (!path) {
      this.agentBundleCache = { path: null, bundle: null, sha256: null };
      return this.agentBundleCache;
    }

    try {
      const bundle = await loadPolicyBundleFromFile(path);
      const canonicalJson = stableJsonStringify(bundle);
      const sha256 = sha256HexFromString(canonicalJson);
      this.agentBundleCache = { path, bundle, sha256 };
      return this.agentBundleCache;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.logger?.warn("policy.bundle.agent_load_failed", { path, error: message });
      this.agentBundleCache = { path, bundle: null, sha256: null };
      return this.agentBundleCache;
    }
  }
}

function mergePolicyBundles(bundles: Array<PolicyBundleT | undefined>): PolicyBundleT {
  const base = PolicyBundle.parse({ v: 1 });

  const tools = mergeDomain(
    bundles.map((b) => (b?.tools ? normalizeDomain(b.tools, "require_approval") : undefined)),
    normalizeDomain(base.tools, "require_approval").default,
  );
  const networkEgress = mergeDomain(
    bundles.map((b) =>
      b?.network_egress ? normalizeDomain(b.network_egress, "require_approval") : undefined,
    ),
    normalizeDomain(base.network_egress, "require_approval").default,
  );
  const secrets = mergeDomain(
    bundles.map((b) => (b?.secrets ? normalizeDomain(b.secrets, "require_approval") : undefined)),
    normalizeDomain(base.secrets, "require_approval").default,
  );
  const connectors = mergeDomain(
    bundles.map((b) =>
      b?.connectors ? normalizeDomain(b.connectors, "require_approval") : undefined,
    ),
    normalizeDomain(base.connectors, "require_approval").default,
  );

  const artifactsDefault = bundles.reduce<Decision>(
    (acc, b) => (b?.artifacts?.default ? mostRestrictiveDecision(acc, b.artifacts.default) : acc),
    base.artifacts?.default ?? "allow",
  );
  const retentionDaysDefaults = bundles
    .map((b) => b?.artifacts?.retention?.default_days)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  const quotaMaxBytesDefaults = bundles
    .map((b) => b?.artifacts?.quota?.default_max_bytes)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);

  const retentionDefaultDays = [...retentionDaysDefaults];
  const maxBytesDefault = [...quotaMaxBytesDefaults];

  const retentionBySensitivityValues = bundles
    .map((b) => b?.artifacts?.retention?.by_sensitivity)
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object");
  const quotaBySensitivityValues = bundles
    .map((b) => b?.artifacts?.quota?.by_sensitivity)
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object");

  const retentionBySensitivity = {
    normal: retentionBySensitivityValues
      .map((v) => v["normal"])
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
      .reduce<number | undefined>(
        (acc, n) => (acc === undefined ? n : Math.min(acc, n)),
        undefined,
      ),
    sensitive: retentionBySensitivityValues
      .map((v) => v["sensitive"])
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
      .reduce<number | undefined>(
        (acc, n) => (acc === undefined ? n : Math.min(acc, n)),
        undefined,
      ),
  } as const;

  const quotaBySensitivity = {
    normal: quotaBySensitivityValues
      .map((v) => v["normal"])
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
      .reduce<number | undefined>(
        (acc, n) => (acc === undefined ? n : Math.min(acc, n)),
        undefined,
      ),
    sensitive: quotaBySensitivityValues
      .map((v) => v["sensitive"])
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0)
      .reduce<number | undefined>(
        (acc, n) => (acc === undefined ? n : Math.min(acc, n)),
        undefined,
      ),
  } as const;

  const retentionByLabel: Record<string, number> = {};
  for (const bundle of bundles) {
    const raw = bundle?.artifacts?.retention?.by_label;
    if (!raw) continue;
    for (const [label, value] of Object.entries(raw)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
      const prev = retentionByLabel[label];
      retentionByLabel[label] = prev === undefined ? value : Math.min(prev, value);
    }
  }

  const quotaByLabel: Record<string, number> = {};
  for (const bundle of bundles) {
    const raw = bundle?.artifacts?.quota?.by_label;
    if (!raw) continue;
    for (const [label, value] of Object.entries(raw)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
      const prev = quotaByLabel[label];
      quotaByLabel[label] = prev === undefined ? value : Math.min(prev, value);
    }
  }

  const retentionByLabelSensitivity: Record<string, { normal?: number; sensitive?: number }> = {};
  for (const bundle of bundles) {
    const raw = bundle?.artifacts?.retention?.by_label_sensitivity;
    if (!raw) continue;
    for (const [label, value] of Object.entries(raw)) {
      if (!value || typeof value !== "object") continue;
      const entry = retentionByLabelSensitivity[label] ?? (retentionByLabelSensitivity[label] = {});

      const normal = (value as Record<string, unknown>)["normal"];
      if (typeof normal === "number" && Number.isFinite(normal) && normal > 0) {
        entry.normal = entry.normal === undefined ? normal : Math.min(entry.normal, normal);
      }

      const sensitive = (value as Record<string, unknown>)["sensitive"];
      if (typeof sensitive === "number" && Number.isFinite(sensitive) && sensitive > 0) {
        entry.sensitive =
          entry.sensitive === undefined ? sensitive : Math.min(entry.sensitive, sensitive);
      }
    }
  }

  const quotaByLabelSensitivity: Record<string, { normal?: number; sensitive?: number }> = {};
  for (const bundle of bundles) {
    const raw = bundle?.artifacts?.quota?.by_label_sensitivity;
    if (!raw) continue;
    for (const [label, value] of Object.entries(raw)) {
      if (!value || typeof value !== "object") continue;
      const entry = quotaByLabelSensitivity[label] ?? (quotaByLabelSensitivity[label] = {});

      const normal = (value as Record<string, unknown>)["normal"];
      if (typeof normal === "number" && Number.isFinite(normal) && normal > 0) {
        entry.normal = entry.normal === undefined ? normal : Math.min(entry.normal, normal);
      }

      const sensitive = (value as Record<string, unknown>)["sensitive"];
      if (typeof sensitive === "number" && Number.isFinite(sensitive) && sensitive > 0) {
        entry.sensitive =
          entry.sensitive === undefined ? sensitive : Math.min(entry.sensitive, sensitive);
      }
    }
  }

  const retentionDefault =
    retentionDefaultDays.length > 0 ? Math.min(...retentionDefaultDays) : undefined;
  const maxBytesDefaultValue =
    maxBytesDefault.length > 0 ? Math.min(...maxBytesDefault) : undefined;

  const provenanceValues = new Set(
    bundles
      .map((b) => b?.provenance?.untrusted_shell_requires_approval)
      .filter((v): v is boolean => typeof v === "boolean"),
  );
  const provenanceShellApproval = provenanceValues.has(true) || !provenanceValues.has(false);

  return PolicyBundle.parse({
    v: 1,
    tools,
    network_egress: networkEgress,
    secrets,
    connectors,
    artifacts: {
      default: artifactsDefault,
      retention:
        retentionDefault !== undefined ||
        Object.keys(retentionByLabel).length > 0 ||
        retentionBySensitivity.normal !== undefined ||
        retentionBySensitivity.sensitive !== undefined ||
        Object.keys(retentionByLabelSensitivity).length > 0
          ? {
              default_days: retentionDefault,
              by_label: Object.keys(retentionByLabel).length > 0 ? retentionByLabel : undefined,
              by_sensitivity:
                retentionBySensitivity.normal !== undefined ||
                retentionBySensitivity.sensitive !== undefined
                  ? retentionBySensitivity
                  : undefined,
              by_label_sensitivity:
                Object.keys(retentionByLabelSensitivity).length > 0
                  ? retentionByLabelSensitivity
                  : undefined,
            }
          : undefined,
      quota:
        maxBytesDefaultValue !== undefined ||
        Object.keys(quotaByLabel).length > 0 ||
        quotaBySensitivity.normal !== undefined ||
        quotaBySensitivity.sensitive !== undefined ||
        Object.keys(quotaByLabelSensitivity).length > 0
          ? {
              default_max_bytes: maxBytesDefaultValue,
              by_label: Object.keys(quotaByLabel).length > 0 ? quotaByLabel : undefined,
              by_sensitivity:
                quotaBySensitivity.normal !== undefined ||
                quotaBySensitivity.sensitive !== undefined
                  ? quotaBySensitivity
                  : undefined,
              by_label_sensitivity:
                Object.keys(quotaByLabelSensitivity).length > 0
                  ? quotaByLabelSensitivity
                  : undefined,
            }
          : undefined,
    },
    provenance: {
      untrusted_shell_requires_approval: provenanceShellApproval,
    },
  });
}
