import type {
  LifecycleHookDefinition as LifecycleHookDefinitionT,
  PolicyBundle as PolicyBundleT,
} from "@tyrum/schemas";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { LifecycleHookConfigDal } from "../../src/modules/hooks/config-dal.js";
import { PolicyBundleConfigDal } from "../../src/modules/policy/config-dal.js";
import type { SqlDb } from "../../src/statestore/types.js";

export async function seedDeploymentPolicyBundle(
  db: SqlDb,
  bundle: PolicyBundleT,
  tenantId = DEFAULT_TENANT_ID,
): Promise<void> {
  await new PolicyBundleConfigDal(db).set({
    scope: { tenantId, scopeKind: "deployment" },
    bundle,
    createdBy: { kind: "test" },
    reason: "seed",
  });
}

export async function seedAgentPolicyBundle(
  db: SqlDb,
  input: { agentId: string; bundle: PolicyBundleT; tenantId?: string },
): Promise<void> {
  await new PolicyBundleConfigDal(db).set({
    scope: {
      tenantId: input.tenantId ?? DEFAULT_TENANT_ID,
      scopeKind: "agent",
      agentId: input.agentId,
    },
    bundle: input.bundle,
    createdBy: { kind: "test" },
    reason: "seed",
  });
}

export async function seedLifecycleHooks(
  db: SqlDb,
  hooks: LifecycleHookDefinitionT[],
  tenantId = DEFAULT_TENANT_ID,
): Promise<void> {
  await new LifecycleHookConfigDal(db).set({
    tenantId,
    hooks,
    createdBy: { kind: "test" },
    reason: "seed",
  });
}
