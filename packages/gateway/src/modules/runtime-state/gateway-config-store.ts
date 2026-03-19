import type {
  LifecycleHookDefinition as LifecycleHookDefinitionT,
  PolicyBundle as PolicyBundleT,
} from "@tyrum/contracts";
import { LifecycleHookConfigDal } from "../hooks/config-dal.js";
import { PolicyBundleConfigDal } from "../policy/config-dal.js";
import type { SqlDb } from "../../statestore/types.js";

export interface GatewayConfigStore {
  getLifecycleHooks(tenantId: string): Promise<LifecycleHookDefinitionT[]>;
  getDeploymentPolicyBundle(tenantId: string): Promise<PolicyBundleT | null>;
  getAgentPolicyBundle(scope: { tenantId: string; agentId: string }): Promise<PolicyBundleT | null>;
}
class DbGatewayConfigStore implements GatewayConfigStore {
  private readonly hooksDal: LifecycleHookConfigDal;
  private readonly policyBundleDal: PolicyBundleConfigDal;

  constructor(db: SqlDb) {
    this.hooksDal = new LifecycleHookConfigDal(db);
    this.policyBundleDal = new PolicyBundleConfigDal(db);
  }

  async getLifecycleHooks(tenantId: string): Promise<LifecycleHookDefinitionT[]> {
    return (await this.hooksDal.getLatest(tenantId))?.hooks ?? [];
  }

  async getDeploymentPolicyBundle(tenantId: string): Promise<PolicyBundleT | null> {
    return (
      (await this.policyBundleDal.getLatest({ tenantId, scopeKind: "deployment" }))?.bundle ?? null
    );
  }

  async getAgentPolicyBundle(scope: {
    tenantId: string;
    agentId: string;
  }): Promise<PolicyBundleT | null> {
    return (
      (
        await this.policyBundleDal.getLatest({
          tenantId: scope.tenantId,
          scopeKind: "agent",
          agentId: scope.agentId,
        })
      )?.bundle ?? null
    );
  }
}

export function createGatewayConfigStore(params: {
  db: SqlDb;
  home: string;
  logger?: unknown;
  deploymentConfig: {
    policy?: {
      bundlePath?: string;
    };
    state?: {
      mode?: string;
    };
  };
  includeAgentHomeBundle?: boolean;
}): GatewayConfigStore {
  return new DbGatewayConfigStore(params.db);
}
