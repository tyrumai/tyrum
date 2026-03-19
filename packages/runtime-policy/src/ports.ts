import type {
  PolicyBundle as PolicyBundleT,
  PolicyOverride as PolicyOverrideT,
  PolicyOverrideStatus as PolicyOverrideStatusT,
} from "@tyrum/contracts";

export interface PolicySnapshotRow {
  policy_snapshot_id: string;
  sha256: string;
  created_at: string;
  bundle: PolicyBundleT;
}

export interface PolicyOverrideRow extends PolicyOverrideT {}

export interface PolicySnapshotStore {
  getById(tenantId: string, policySnapshotId: string): Promise<PolicySnapshotRow | undefined>;
  getOrCreate(tenantId: string, bundle: PolicyBundleT): Promise<PolicySnapshotRow>;
}

export interface PolicyOverrideStore {
  list(params: {
    tenantId: string;
    agentId?: string;
    toolId?: string;
    status?: PolicyOverrideStatusT;
    limit?: number;
  }): Promise<PolicyOverrideRow[]>;
  create(params: {
    tenantId: string;
    agentId: string;
    workspaceId?: string;
    toolId: string;
    pattern: string;
    createdBy?: unknown;
    createdFromApprovalId?: string;
    createdFromPolicySnapshotId?: string;
    expiresAt?: string | null;
  }): Promise<PolicyOverrideRow>;
  revoke(params: {
    tenantId: string;
    policyOverrideId: string;
    revokedBy?: unknown;
    reason?: string;
  }): Promise<PolicyOverrideRow | undefined>;
  expireStale(params: { tenantId: string; nowIso?: string }): Promise<PolicyOverrideRow[]>;
  listActiveForTool(params: {
    tenantId: string;
    agentId: string;
    workspaceId?: string;
    toolId: string;
  }): Promise<PolicyOverrideRow[]>;
}

export interface PolicyBundleStore {
  getDeploymentPolicyBundle(tenantId: string): Promise<PolicyBundleT | null | undefined>;
  getAgentPolicyBundle(scope: {
    tenantId: string;
    agentId: string;
  }): Promise<PolicyBundleT | null | undefined>;
}
