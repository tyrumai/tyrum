import {
  DEFAULT_PUBLIC_BASE_URL,
  DeploymentConfig,
  type DeploymentConfig as DeploymentConfigT,
} from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import { DesktopEnvironmentDal } from "../desktop-environments/dal.js";
import { DesktopEnvironmentLifecycleService } from "../desktop-environments/lifecycle-service.js";
import { ManagedDesktopAttachmentService } from "../desktop-environments/managed-desktop-attachment-service.js";

export async function provisionManagedDesktop(params: {
  db: SqlDb;
  tenantId: string;
  subagentSessionKey: string;
  subagentLane: string;
  label: string;
  defaultDeploymentConfig?: DeploymentConfigT;
  updatedAtMs?: number;
}): Promise<{ desktopEnvironmentId: string; attachedNodeId?: string } | undefined> {
  const attachmentService = new ManagedDesktopAttachmentService({
    db: params.db,
    defaultDeploymentConfig:
      params.defaultDeploymentConfig ??
      DeploymentConfig.parse({ server: { publicBaseUrl: DEFAULT_PUBLIC_BASE_URL } }),
  });
  const attachment = await attachmentService.requestManagedDesktop({
    tenantId: params.tenantId,
    key: params.subagentSessionKey,
    lane: params.subagentLane,
    label: params.label,
    updatedAtMs: params.updatedAtMs,
  });
  return attachment?.managed_desktop_attached || attachment?.desktop_environment_id
    ? attachment.desktop_environment_id
      ? {
          desktopEnvironmentId: attachment.desktop_environment_id,
          attachedNodeId: attachment.attached_node_id,
        }
      : undefined
    : undefined;
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
