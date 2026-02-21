import type { PolicyBundle as PolicyBundleT, Decision } from "@tyrum/schemas";
import { PolicyBundle } from "@tyrum/schemas";
import { access } from "node:fs/promises";
import { wildcardMatch } from "./wildcard.js";
import { defaultPolicyBundle, loadPolicyBundleFromFile } from "./bundle-loader.js";
import type { PolicySnapshotDal, PolicySnapshotRow } from "./snapshot-dal.js";
import type { PolicyOverrideDal } from "./override-dal.js";
import { sha256HexFromString, stableJsonStringify } from "./canonical-json.js";

type PolicyDomainConfig = {
  default: Decision;
  allow: readonly string[];
  require_approval: readonly string[];
  deny: readonly string[];
};

function isFalsyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v.length > 0 && ["0", "false", "off", "no"].includes(v);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function mostRestrictive(a: Decision, b: Decision): Decision {
  if (a === "deny" || b === "deny") return "deny";
  if (a === "require_approval" || b === "require_approval") return "require_approval";
  return "allow";
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
    defaultDecision = mostRestrictive(defaultDecision, domain.default);
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

function normalizeDomain(
  value:
    | {
        default: Decision;
        allow: string[];
        require_approval: string[];
        deny: string[];
      }
    | undefined,
  fallbackDefault: Decision,
): PolicyDomainConfig {
  if (!value) {
    return { default: fallbackDefault, allow: [], require_approval: [], deny: [] };
  }
  return {
    default: value.default,
    allow: value.allow ?? [],
    require_approval: value.require_approval ?? [],
    deny: value.deny ?? [],
  };
}

function evaluateDomain(domain: PolicyDomainConfig, matchTarget: string): Decision {
  const target = matchTarget.trim();

  for (const pat of domain.deny) {
    if (wildcardMatch(pat, target)) return "deny";
  }
  for (const pat of domain.require_approval) {
    if (wildcardMatch(pat, target)) return "require_approval";
  }
  for (const pat of domain.allow) {
    if (wildcardMatch(pat, target)) return "allow";
  }

  return domain.default;
}

function normalizeUrlForPolicy(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  try {
    const url = new URL(trimmed);
    const pathname = url.pathname || "/";
    return `${url.protocol}//${url.host}${pathname}`;
  } catch {
    // Avoid leaking query params (may contain secrets) by truncating at '?'.
    const q = trimmed.indexOf("?");
    return q === -1 ? trimmed : trimmed.slice(0, q);
  }
}

export interface PolicyEvaluation {
  decision: Decision;
  policy_snapshot?: PolicySnapshotRow;
  applied_override_ids?: string[];
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
    },
  ) {}

  isEnabled(): boolean {
    const raw = process.env["TYRUM_POLICY_ENABLED"];
    if (isFalsyEnvFlag(raw)) return false;
    return true;
  }

  isObserveOnly(): boolean {
    const mode = process.env["TYRUM_POLICY_MODE"]?.trim().toLowerCase();
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

    const merged = mergePolicyBundles(
      [deployment.bundle, agent.bundle ?? undefined, playbookBundle],
    );
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

  async getOrCreateSnapshot(bundle: PolicyBundleT): Promise<PolicySnapshotRow> {
    return await this.opts.snapshotDal.getOrCreate(bundle);
  }

  async evaluateToolCall(params: {
    agentId: string;
    workspaceId?: string;
    toolId: string;
    toolMatchTarget: string;
    url?: string;
    secretScopes?: string[];
    playbookBundle?: PolicyBundleT;
  }): Promise<PolicyEvaluation> {
    const effective = await this.loadEffectiveBundle({ playbookBundle: params.playbookBundle });
    const snapshot = await this.getOrCreateSnapshot(effective.bundle);

    const toolsDomain = normalizeDomain(effective.bundle.tools, "require_approval");
    const egressDomain = normalizeDomain(effective.bundle.network_egress, "require_approval");
    const secretsDomain = normalizeDomain(effective.bundle.secrets, "require_approval");

    let toolDecision = evaluateDomain(toolsDomain, params.toolId);

    let egressDecision: Decision = "allow";
    if (params.url) {
      const normalizedUrl = normalizeUrlForPolicy(params.url);
      if (normalizedUrl.length > 0) {
        egressDecision = evaluateDomain(egressDomain, normalizedUrl);
      }
    }

    let secretsDecision: Decision = "allow";
    if (params.secretScopes && params.secretScopes.length > 0) {
      let decision: Decision = "allow";
      for (const scope of params.secretScopes) {
        decision = mostRestrictive(decision, evaluateDomain(secretsDomain, scope));
      }
      secretsDecision = decision;
    }

    let decision = mostRestrictive(toolDecision, mostRestrictive(egressDecision, secretsDecision));

    const appliedOverrides: string[] = [];
    if (decision === "require_approval" && toolDecision === "require_approval") {
      const overrides = await this.opts.overrideDal.listActiveForTool({
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
        decision = mostRestrictive(toolDecision, mostRestrictive(egressDecision, secretsDecision));
      }
    }

    return {
      decision,
      policy_snapshot: snapshot,
      applied_override_ids: appliedOverrides.length > 0 ? appliedOverrides : undefined,
    };
  }

  async evaluateConnectorAction(params: {
    agentId: string;
    workspaceId?: string;
    matchTarget: string;
    playbookBundle?: PolicyBundleT;
  }): Promise<PolicyEvaluation> {
    const effective = await this.loadEffectiveBundle({ playbookBundle: params.playbookBundle });
    const snapshot = await this.getOrCreateSnapshot(effective.bundle);

    const connectorsDomain = normalizeDomain(effective.bundle.connectors, "require_approval");
    const decision = evaluateDomain(connectorsDomain, params.matchTarget);

    return {
      decision,
      policy_snapshot: snapshot,
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

  private async loadDeploymentBundle(): Promise<{ path: string | null; bundle: PolicyBundleT; sha256: string }> {
    const path = process.env["TYRUM_POLICY_BUNDLE_PATH"]?.trim() || null;
    if (this.deploymentBundleCache && this.deploymentBundleCache.path === path) {
      return this.deploymentBundleCache;
    }

    let bundle: PolicyBundleT;
    if (path) {
      try {
        bundle = await loadPolicyBundleFromFile(path);
      } catch {
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

  private async loadAgentBundle(): Promise<{ path: string | null; bundle: PolicyBundleT | null; sha256: string | null }> {
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
    } catch {
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
    (acc, b) => (b?.artifacts?.default ? mostRestrictive(acc, b.artifacts.default) : acc),
    base.artifacts?.default ?? "allow",
  );
  const retentionDays = bundles
    .map((b) => b?.artifacts?.retention_days)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  const maxBytes = bundles
    .map((b) => b?.artifacts?.max_bytes)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);

  const provenanceShellApproval = bundles.some(
    (b) => b?.provenance?.untrusted_shell_requires_approval === true,
  );

  return PolicyBundle.parse({
    v: 1,
    tools,
    network_egress: networkEgress,
    secrets,
    connectors,
    artifacts: {
      default: artifactsDefault,
      retention_days: retentionDays.length > 0 ? Math.min(...retentionDays) : undefined,
      max_bytes: maxBytes.length > 0 ? Math.min(...maxBytes) : undefined,
    },
    provenance: {
      untrusted_shell_requires_approval: provenanceShellApproval,
    },
  });
}
