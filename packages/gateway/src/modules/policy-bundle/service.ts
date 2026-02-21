import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parse as parseYaml } from "yaml";
import { PolicyBundle } from "@tyrum/schemas";
import type { PolicyBundle as PolicyBundleT } from "@tyrum/schemas";
import type {
  PolicyEffect as PolicyEffectT,
  PolicyRuleList as PolicyRuleListT,
  PolicyNetworkEgress as PolicyNetworkEgressT,
  PolicySecretResolution as PolicySecretResolutionT,
  PolicyProvenanceConfig as PolicyProvenanceConfigT,
} from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";
import {
  evaluateAction,
  evaluateToolCall,
  matchesGlob,
  type PolicyEvaluation,
  type PolicyProvenanceContext,
} from "./evaluate.js";
import { PolicyOverrideDal } from "../policy-overrides/dal.js";
import { computeToolMatchTarget } from "../policy-overrides/match-target.js";
import { resolveAgentHome } from "../agent/home.js";

export type PolicyScopeKind = "deployment" | "agent" | "playbook";

type PolicyFormat = "json" | "yaml";

interface PolicyBundleRow {
  scope_kind: PolicyScopeKind;
  scope_id: string;
  version: number;
  format: PolicyFormat;
  content_json: string;
  content_hash: string;
  updated_at: string | Date;
}

interface PolicySnapshotRow {
  policy_snapshot_id: string;
  content_json: string;
  content_hash: string;
  sources_json: string | null;
  created_at: string | Date;
  created_by: string | null;
}

export interface PolicyBundleSource {
  scope_kind: PolicyScopeKind;
  scope_id: string;
  content_hash: string;
}

const DEFAULT_DEPLOYMENT_SCOPE_ID = "default";

export const DEFAULT_DEPLOYMENT_POLICY_BUNDLE: PolicyBundleT = PolicyBundle.parse({
  version: 1,
  tools: {
    // Enforce approvals for risky tools even if tool descriptors/config drift.
    require_approval: [
      "tool.exec",
      "tool.fs.write",
      "tool.http.fetch",
      "tool.node.dispatch",
      "mcp.*",
    ],
    default: "allow",
  },
  actions: {
    default: "allow",
  },
  network: {
    // Default-deny automation: any egress requires approval unless explicitly allowlisted.
    egress: {
      default: "require_approval",
      allow_hosts: ["*"],
      deny_hosts: [],
      require_approval_hosts: [],
    },
  },
  secrets: {
    // Secret resolution is approval-gated by default.
    resolve: {
      default: "require_approval",
      allow: [],
      deny: [],
      require_approval: ["*"],
    },
  },
});

type BundleScope = { scopeKind: PolicyScopeKind; scopeId: string };

interface BundleWithHash extends BundleScope {
  bundle: PolicyBundleT;
  contentHash: string;
}

function stableSortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSortJson);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v === undefined) continue;
      out[key] = stableSortJson(v);
    }
    return out;
  }
  return value;
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(stableSortJson(value));
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

function uniqSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function intersectNonEmptyLists(lists: readonly (readonly string[])[]): string[] {
  const nonEmpty = lists.filter((l) => l.length > 0);
  if (nonEmpty.length === 0) return [];
  let acc = new Set(nonEmpty[0]!);
  for (const list of nonEmpty.slice(1)) {
    const next = new Set<string>();
    for (const v of acc) {
      if (list.includes(v)) next.add(v);
    }
    acc = next;
  }
  return [...acc].sort();
}

function rankEffect(effect: PolicyEffectT): number {
  switch (effect) {
    case "deny":
      return 2;
    case "require_approval":
      return 1;
    case "allow":
      return 0;
  }
}

function combineEffect(a: PolicyEffectT, b: PolicyEffectT): PolicyEffectT {
  return rankEffect(b) > rankEffect(a) ? b : a;
}

function mergeRuleLists(lists: readonly PolicyRuleListT[]): PolicyRuleListT {
  return {
    allow: intersectNonEmptyLists(lists.map((l) => l.allow)),
    deny: uniqSorted(lists.flatMap((l) => l.deny)),
    require_approval: uniqSorted(lists.flatMap((l) => l.require_approval)),
    default: lists.reduce<PolicyEffectT>((acc, next) => combineEffect(acc, next.default), "allow"),
  };
}

function mergeNetworkEgress(lists: readonly PolicyNetworkEgressT[]): PolicyNetworkEgressT {
  return {
    allow_hosts: intersectNonEmptyLists(lists.map((l) => l.allow_hosts)),
    deny_hosts: uniqSorted(lists.flatMap((l) => l.deny_hosts)),
    require_approval_hosts: uniqSorted(lists.flatMap((l) => l.require_approval_hosts)),
    default: lists.reduce<PolicyEffectT>((acc, next) => combineEffect(acc, next.default), "allow"),
  };
}

function mergeSecretResolution(lists: readonly PolicySecretResolutionT[]): PolicySecretResolutionT {
  return {
    allow: intersectNonEmptyLists(lists.map((l) => l.allow)),
    deny: uniqSorted(lists.flatMap((l) => l.deny)),
    require_approval: uniqSorted(lists.flatMap((l) => l.require_approval)),
    default: lists.reduce<PolicyEffectT>((acc, next) => combineEffect(acc, next.default), "allow"),
  };
}

function mergeProvenanceConfig(configs: readonly PolicyProvenanceConfigT[]): PolicyProvenanceConfigT {
  const rules = configs.flatMap((c) => c.rules ?? []);
  return { rules };
}

function mergePolicyBundles(bundles: readonly PolicyBundleT[]): PolicyBundleT {
  if (bundles.length === 0) {
    return DEFAULT_DEPLOYMENT_POLICY_BUNDLE;
  }

  return PolicyBundle.parse({
    version: 1,
    tools: mergeRuleLists(bundles.map((b) => b.tools)),
    actions: mergeRuleLists(bundles.map((b) => b.actions)),
    network: {
      egress: mergeNetworkEgress(bundles.map((b) => b.network.egress)),
    },
    secrets: {
      resolve: mergeSecretResolution(bundles.map((b) => b.secrets.resolve)),
    },
    provenance: mergeProvenanceConfig(bundles.map((b) => b.provenance)),
  });
}

function inferFormat(path: string): PolicyFormat {
  const ext = extname(path).toLowerCase();
  if (ext === ".yaml" || ext === ".yml") return "yaml";
  return "json";
}

function parsePolicyContent(raw: string, format: PolicyFormat): unknown {
  if (format === "yaml") {
    return parseYaml(raw) as unknown;
  }
  return JSON.parse(raw) as unknown;
}

export class PolicyBundleService {
  private readonly cacheTtlMs: number;
  private readonly logger?: Logger;
  private readonly policyOverrideDal: PolicyOverrideDal;

  private envLoaded = false;
  private deploymentCache:
    | { bundle: PolicyBundleT; contentJson: string; contentHash: string; loadedAtMs: number }
    | null = null;

  constructor(
    private readonly db: SqlDb,
    opts?: { cacheTtlMs?: number; logger?: Logger },
  ) {
    this.cacheTtlMs = Math.max(0, opts?.cacheTtlMs ?? 5_000);
    this.logger = opts?.logger;
    this.policyOverrideDal = new PolicyOverrideDal(db);
  }

  async evaluateToolCall(
    toolId: string,
    args: unknown,
    opts?: {
      agentId?: string;
      workspaceId?: string;
      playbookId?: string;
      provenance?: PolicyProvenanceContext;
    },
  ): Promise<PolicyEvaluation> {
    const { policy } = await this.getEffectivePolicy({
      agentId: opts?.agentId,
      playbookId: opts?.playbookId,
    });
    const baseline = evaluateToolCall(policy, toolId, args, opts?.provenance);

    if (baseline.decision !== "require_approval") {
      return baseline;
    }

    const agentId = opts?.agentId;
    if (!agentId) return baseline;

    const matchTarget = computeToolMatchTarget(toolId, args, { home: resolveAgentHome(agentId) });
    if (!matchTarget) return baseline;

    const overrides = await this.policyOverrideDal.listActiveForTool({
      agentId,
      workspaceId: opts?.workspaceId ?? null,
      toolId,
    });

    const matches = overrides.filter((o) => matchesGlob(o.pattern, matchTarget));
    if (matches.length === 0) return baseline;

    return {
      decision: "allow",
      reasons: [
        ...baseline.reasons,
        {
          domain: "tool",
          code: "policy_override",
          message: `policy override(s) applied for tool '${toolId}'`,
        },
      ],
      policy_override_ids: matches.map((m) => m.policy_override_id),
    };
  }

  async evaluateAction(
    action: Parameters<typeof evaluateAction>[1],
    opts?: {
      agentId?: string;
      playbookId?: string;
      provenance?: PolicyProvenanceContext;
    },
  ): Promise<PolicyEvaluation> {
    const { policy } = await this.getEffectivePolicy({
      agentId: opts?.agentId,
      playbookId: opts?.playbookId,
    });
    return evaluateAction(policy, action, opts?.provenance);
  }

  async getBundle(scope: BundleScope): Promise<BundleWithHash | undefined> {
    if (scope.scopeKind === "deployment" && scope.scopeId === DEFAULT_DEPLOYMENT_SCOPE_ID) {
      const policy = await this.getDeploymentPolicy();
      const contentJson = stableJsonStringify(policy);
      const contentHash = sha256Hex(contentJson);
      return {
        scopeKind: "deployment",
        scopeId: DEFAULT_DEPLOYMENT_SCOPE_ID,
        bundle: policy,
        contentHash,
      };
    }

    const row = await this.db.get<PolicyBundleRow>(
      `SELECT scope_kind, scope_id, version, format, content_json, content_hash, updated_at
       FROM policy_bundles
       WHERE scope_kind = ? AND scope_id = ?`,
      [scope.scopeKind, scope.scopeId],
    );
    if (!row) return undefined;

    const parsed = PolicyBundle.safeParse(JSON.parse(row.content_json) as unknown);
    if (!parsed.success) {
      throw new Error(`invalid PolicyBundle stored in DB (${row.scope_kind}/${row.scope_id}): ${parsed.error.message}`);
    }

    const contentJson = stableJsonStringify(parsed.data);
    const contentHash = sha256Hex(contentJson);
    return {
      scopeKind: row.scope_kind,
      scopeId: row.scope_id,
      bundle: parsed.data,
      contentHash,
    };
  }

  async setBundle(opts: {
    scopeKind: PolicyScopeKind;
    scopeId: string;
    format?: PolicyFormat;
    bundle: PolicyBundleT;
  }): Promise<{ contentHash: string }> {
    const format = opts.format ?? "json";
    await this.upsertBundle({
      scopeKind: opts.scopeKind,
      scopeId: opts.scopeId,
      format,
      bundle: opts.bundle,
    });

    const contentJson = stableJsonStringify(opts.bundle);
    const contentHash = sha256Hex(contentJson);
    return { contentHash };
  }

  async getDeploymentPolicy(): Promise<PolicyBundleT> {
    await this.loadDeploymentFromEnvOnce();

    const cached = this.deploymentCache;
    if (cached && Date.now() - cached.loadedAtMs <= this.cacheTtlMs) {
      return cached.bundle;
    }

    const row = await this.db.get<PolicyBundleRow>(
      `SELECT scope_kind, scope_id, version, format, content_json, content_hash, updated_at
       FROM policy_bundles
       WHERE scope_kind = ? AND scope_id = ?`,
      ["deployment", DEFAULT_DEPLOYMENT_SCOPE_ID],
    );

    if (!row) {
      await this.upsertBundle({
        scopeKind: "deployment",
        scopeId: DEFAULT_DEPLOYMENT_SCOPE_ID,
        format: "json",
        bundle: DEFAULT_DEPLOYMENT_POLICY_BUNDLE,
      });
      return await this.getDeploymentPolicy();
    }

    const parsed = PolicyBundle.safeParse(JSON.parse(row.content_json) as unknown);
    if (!parsed.success) {
      throw new Error(`invalid PolicyBundle stored in DB (${row.scope_kind}/${row.scope_id}): ${parsed.error.message}`);
    }

    const contentJson = stableJsonStringify(parsed.data);
    const contentHash = sha256Hex(contentJson);
    this.deploymentCache = {
      bundle: parsed.data,
      contentJson,
      contentHash,
      loadedAtMs: Date.now(),
    };

    return parsed.data;
  }

  async getEffectivePolicy(opts: {
    agentId?: string;
    playbookId?: string;
  }): Promise<{ policy: PolicyBundleT; sources: PolicyBundleSource[] }> {
    const bundles: BundleWithHash[] = [];

    const deployment = await this.getBundle({
      scopeKind: "deployment",
      scopeId: DEFAULT_DEPLOYMENT_SCOPE_ID,
    });
    if (deployment) {
      bundles.push(deployment);
    }

    if (opts.agentId) {
      const agent = await this.getBundle({ scopeKind: "agent", scopeId: opts.agentId });
      if (agent) bundles.push(agent);
    }

    if (opts.playbookId) {
      const playbook = await this.getBundle({ scopeKind: "playbook", scopeId: opts.playbookId });
      if (playbook) bundles.push(playbook);
    }

    const policy = mergePolicyBundles(bundles.map((b) => b.bundle));
    const sources = bundles.map((b) => ({
      scope_kind: b.scopeKind,
      scope_id: b.scopeId,
      content_hash: b.contentHash,
    }));

    return { policy, sources };
  }

  async getOrCreateDeploymentSnapshot(createdBy?: string): Promise<{
    policy: PolicyBundleT;
    policySnapshotId: string;
    contentHash: string;
  }> {
    return await this.getOrCreateSnapshot({ createdBy });
  }

  async getOrCreateSnapshot(opts: {
    agentId?: string;
    playbookId?: string;
    createdBy?: string;
  }): Promise<{
    policy: PolicyBundleT;
    policySnapshotId: string;
    contentHash: string;
    sources: PolicyBundleSource[];
  }> {
    const { policy, sources } = await this.getEffectivePolicy({
      agentId: opts.agentId,
      playbookId: opts.playbookId,
    });
    const contentJson = stableJsonStringify(policy);
    const contentHash = sha256Hex(contentJson);

    const existing = await this.db.get<Pick<PolicySnapshotRow, "policy_snapshot_id">>(
      "SELECT policy_snapshot_id FROM policy_snapshots WHERE content_hash = ?",
      [contentHash],
    );
    if (existing?.policy_snapshot_id) {
      return {
        policy,
        policySnapshotId: existing.policy_snapshot_id,
        contentHash,
        sources,
      };
    }

    const snapshotId = `policy-${randomUUID()}`;
    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO policy_snapshots (
         policy_snapshot_id,
         content_json,
         content_hash,
         sources_json,
         created_at,
         created_by
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (content_hash) DO NOTHING`,
      [
        snapshotId,
        contentJson,
        contentHash,
        JSON.stringify(sources),
        nowIso,
        opts.createdBy ?? null,
      ],
    );

    const row = await this.db.get<Pick<PolicySnapshotRow, "policy_snapshot_id">>(
      "SELECT policy_snapshot_id FROM policy_snapshots WHERE content_hash = ?",
      [contentHash],
    );
    if (!row?.policy_snapshot_id) {
      throw new Error("policy snapshot insert failed");
    }

    return {
      policy,
      policySnapshotId: row.policy_snapshot_id,
      contentHash,
      sources,
    };
  }

  async getSnapshotById(policySnapshotId: string): Promise<PolicyBundleT | undefined> {
    const row = await this.db.get<PolicySnapshotRow>(
      `SELECT policy_snapshot_id, content_json, content_hash, sources_json, created_at, created_by
       FROM policy_snapshots
       WHERE policy_snapshot_id = ?`,
      [policySnapshotId],
    );
    if (!row) return undefined;

    const parsed = PolicyBundle.safeParse(JSON.parse(row.content_json) as unknown);
    if (!parsed.success) {
      throw new Error(`invalid PolicyBundle snapshot (${row.policy_snapshot_id}): ${parsed.error.message}`);
    }
    return parsed.data;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async upsertBundle(opts: {
    scopeKind: PolicyScopeKind;
    scopeId: string;
    format: PolicyFormat;
    bundle: PolicyBundleT;
  }): Promise<void> {
    const contentJson = stableJsonStringify(opts.bundle);
    const contentHash = sha256Hex(contentJson);
    const nowIso = new Date().toISOString();

    await this.db.run(
      `INSERT INTO policy_bundles (
         scope_kind,
         scope_id,
         version,
         format,
         content_json,
         content_hash,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (scope_kind, scope_id) DO UPDATE SET
         version = excluded.version,
         format = excluded.format,
         content_json = excluded.content_json,
         content_hash = excluded.content_hash,
         updated_at = excluded.updated_at`,
      [
        opts.scopeKind,
        opts.scopeId,
        opts.bundle.version,
        opts.format,
        contentJson,
        contentHash,
        nowIso,
      ],
    );

    if (opts.scopeKind === "deployment" && opts.scopeId === DEFAULT_DEPLOYMENT_SCOPE_ID) {
      this.deploymentCache = {
        bundle: opts.bundle,
        contentJson,
        contentHash,
        loadedAtMs: Date.now(),
      };
    }
  }

  private async loadDeploymentFromEnvOnce(): Promise<void> {
    if (this.envLoaded) return;
    this.envLoaded = true;

    const path = process.env["TYRUM_POLICY_BUNDLE_PATH"]?.trim();
    if (!path) return;

    const format = inferFormat(path);
    const raw = await readFile(path, "utf-8");
    const parsed = parsePolicyContent(raw, format);
    const bundle = PolicyBundle.parse(parsed);

    await this.upsertBundle({
      scopeKind: "deployment",
      scopeId: DEFAULT_DEPLOYMENT_SCOPE_ID,
      format,
      bundle,
    });

    this.logger?.info("policy.bundle.loaded", {
      scope_kind: "deployment",
      scope_id: DEFAULT_DEPLOYMENT_SCOPE_ID,
      format,
      updated_at: new Date().toISOString(),
    });
  }
}
