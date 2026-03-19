import {
  buildExecutorInstruction,
  buildPlannerInstruction,
  maybeFinalizeWorkItem as maybeFinalizeRuntimeWorkItem,
} from "@tyrum/runtime-workboard";
import {
  DEFAULT_PUBLIC_BASE_URL,
  DeploymentConfig,
  isDesktopEnvironmentHostAvailable,
  type DeploymentConfig as DeploymentConfigT,
  type WorkScope,
} from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import { DeploymentConfigDal } from "../config/deployment-config-dal.js";
import { DesktopEnvironmentDal, DesktopEnvironmentHostDal } from "../desktop-environments/dal.js";
import { readDesktopEnvironmentDefaultImageRef } from "../desktop-environments/default-image.js";
import { DesktopEnvironmentLifecycleService } from "../desktop-environments/lifecycle-service.js";
import type { SessionLaneNodeAttachmentDal } from "../agent/session-lane-node-attachment-dal.js";
import { WorkboardDal } from "./dal.js";
export { buildExecutorInstruction, buildPlannerInstruction };
export {
  resolveAgentKeyById,
  runSubagentTurn as runManagedSubagentTurn,
} from "./subagent-runtime-support.js";

export async function provisionManagedDesktop(params: {
  db: SqlDb;
  tenantId: string;
  sessionLaneNodeAttachmentDal: SessionLaneNodeAttachmentDal;
  subagentSessionKey: string;
  subagentLane: string;
  label: string;
  defaultDeploymentConfig?: DeploymentConfigT;
  updatedAtMs?: number;
}): Promise<{ desktopEnvironmentId: string; attachedNodeId?: string } | undefined> {
  const hostDal = new DesktopEnvironmentHostDal(params.db);
  const hosts = await hostDal.list();
  const host = hosts.find((candidate) => isDesktopEnvironmentHostAvailable(candidate));
  if (!host) {
    return undefined;
  }

  const { defaultImageRef } = await readDesktopEnvironmentDefaultImageRef({
    deploymentConfigDal: new DeploymentConfigDal(params.db),
    defaultConfig:
      params.defaultDeploymentConfig ??
      DeploymentConfig.parse({
        server: { publicBaseUrl: DEFAULT_PUBLIC_BASE_URL },
      }),
  });
  const environmentDal = new DesktopEnvironmentDal(params.db);
  const environment = await environmentDal.create({
    tenantId: params.tenantId,
    hostId: host.host_id,
    label: params.label,
    imageRef: defaultImageRef,
    desiredRunning: true,
  });

  const deadline = Date.now() + 3_000;
  let current = environment;
  while (Date.now() < deadline && !current.node_id) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const refreshed = await environmentDal.get({
      tenantId: params.tenantId,
      environmentId: environment.environment_id,
    });
    if (!refreshed) break;
    current = refreshed;
  }

  if (current.node_id) {
    await params.sessionLaneNodeAttachmentDal.upsert({
      tenantId: params.tenantId,
      key: params.subagentSessionKey,
      lane: params.subagentLane,
      attachedNodeId: current.node_id,
      updatedAtMs: params.updatedAtMs,
    });
  }

  return {
    desktopEnvironmentId: current.environment_id,
    attachedNodeId: current.node_id ?? undefined,
  };
}

export async function cleanupManagedDesktop(params: {
  db: SqlDb;
  tenantId: string;
  environmentId: string;
}): Promise<void> {
  const environmentDal = new DesktopEnvironmentDal(params.db);
  const lifecycle = new DesktopEnvironmentLifecycleService(environmentDal);
  await lifecycle.deleteEnvironment({
    tenantId: params.tenantId,
    environmentId: params.environmentId,
  });
}

export async function maybeFinalizeWorkItem(params: {
  workboard: WorkboardDal;
  scope: WorkScope;
  workItemId: string;
}): Promise<void> {
  await maybeFinalizeRuntimeWorkItem({
    repository: params.workboard,
    scope: params.scope,
    workItemId: params.workItemId,
  });
}
