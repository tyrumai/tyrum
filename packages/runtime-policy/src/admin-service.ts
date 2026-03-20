import type { PolicyOverrideStore } from "./ports.js";

export class PolicyAdminService {
  constructor(
    private readonly opts: {
      policyOverrideStore: Pick<PolicyOverrideStore, "list" | "create" | "revoke" | "expireStale">;
    },
  ) {}

  async listOverrides(params: {
    tenantId: string;
    agentId?: string;
    toolId?: string;
    status?: "active" | "revoked" | "expired";
    limit?: number;
  }) {
    await this.opts.policyOverrideStore.expireStale({ tenantId: params.tenantId });
    return await this.opts.policyOverrideStore.list(params);
  }

  async createOverride(params: {
    tenantId: string;
    agentId: string;
    workspaceId?: string;
    toolId: string;
    pattern: string;
    createdBy?: unknown;
    createdFromApprovalId?: string;
    createdFromPolicySnapshotId?: string;
    expiresAt?: string | null;
  }): Promise<
    | {
        ok: true;
        override: Awaited<ReturnType<PolicyOverrideStore["create"]>>;
      }
    | {
        ok: false;
        code: "invalid_request";
        message: string;
      }
  > {
    const override = await this.opts.policyOverrideStore.create(params);
    return { ok: true, override };
  }

  async revokeOverride(params: {
    tenantId: string;
    policyOverrideId: string;
    revokedBy?: unknown;
    reason?: string;
  }) {
    return await this.opts.policyOverrideStore.revoke(params);
  }
}
