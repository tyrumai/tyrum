import { access } from "node:fs/promises";
import type {
  LifecycleHookDefinition as LifecycleHookDefinitionT,
  PolicyBundle as PolicyBundleT,
} from "@tyrum/schemas";
import type { Logger } from "../observability/logger.js";
import { loadLifecycleHooksFromHome } from "../hooks/config.js";
import { LifecycleHookConfigDal } from "../hooks/config-dal.js";
import { loadPolicyBundleFromFile } from "../policy/bundle-loader.js";
import { PolicyBundleConfigDal } from "../policy/config-dal.js";
import type { SqlDb } from "../../statestore/types.js";
import { isSharedStateMode } from "./mode.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    // Intentional: local-mode config fallbacks probe optional files.
    return false;
  }
}

export interface GatewayConfigStore {
  getLifecycleHooks(tenantId: string): Promise<LifecycleHookDefinitionT[]>;
  getDeploymentPolicyBundle(tenantId: string): Promise<PolicyBundleT | null>;
  getAgentPolicyBundle(scope: { tenantId: string; agentId: string }): Promise<PolicyBundleT | null>;
}

class LocalGatewayConfigStore implements GatewayConfigStore {
  constructor(
    private readonly opts: {
      home: string;
      logger?: Logger;
      deploymentPolicy?: {
        bundlePath?: string;
      };
      includeAgentHomeBundle?: boolean;
    },
  ) {}

  async getLifecycleHooks(_tenantId: string): Promise<LifecycleHookDefinitionT[]> {
    return await loadLifecycleHooksFromHome(this.opts.home, this.opts.logger);
  }

  async getDeploymentPolicyBundle(_tenantId: string): Promise<PolicyBundleT | null> {
    const path = this.opts.deploymentPolicy?.bundlePath?.trim();
    if (!path) return null;
    try {
      return await loadPolicyBundleFromFile(path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.opts.logger?.warn("policy.bundle.deployment_load_failed", { path, error: message });
      return null;
    }
  }

  async getAgentPolicyBundle(_scope: {
    tenantId: string;
    agentId: string;
  }): Promise<PolicyBundleT | null> {
    if (this.opts.includeAgentHomeBundle === false) {
      return null;
    }

    const candidates = [
      `${this.opts.home}/policy.yml`,
      `${this.opts.home}/policy.yaml`,
      `${this.opts.home}/policy.json`,
    ];
    for (const path of candidates) {
      if (!(await fileExists(path))) continue;
      try {
        return await loadPolicyBundleFromFile(path);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.opts.logger?.warn("policy.bundle.agent_load_failed", { path, error: message });
        return null;
      }
    }
    return null;
  }
}

class SharedGatewayConfigStore implements GatewayConfigStore {
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
  logger?: Logger;
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
  return isSharedStateMode(params.deploymentConfig)
    ? new SharedGatewayConfigStore(params.db)
    : new LocalGatewayConfigStore({
        home: params.home,
        logger: params.logger,
        deploymentPolicy: params.deploymentConfig.policy,
        includeAgentHomeBundle: params.includeAgentHomeBundle,
      });
}
