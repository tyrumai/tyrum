import type { DeploymentConfig as DeploymentConfigT } from "@tyrum/contracts";
import type { SqlDb } from "../../../statestore/types.js";
import { readRecordString } from "../../util/coerce.js";
import {
  ManagedDesktopAttachmentService,
  type ManagedDesktopAttachmentSummary,
} from "../../desktop-environments/managed-desktop-attachment-service.js";
import { buildSandboxPrompt } from "./turn-helpers.js";

async function resolveSandboxAttachmentSummary(input: {
  db: SqlDb;
  defaultDeploymentConfig: DeploymentConfigT;
  tenantId: string;
  key: string;
  lane: string;
}): Promise<ManagedDesktopAttachmentSummary> {
  return await new ManagedDesktopAttachmentService({
    db: input.db,
    defaultDeploymentConfig: input.defaultDeploymentConfig,
  }).getCurrentAttachmentSummary({
    tenantId: input.tenantId,
    key: input.key,
    lane: input.lane,
  });
}

export async function resolveSandboxPrompt(input: {
  skip: boolean;
  db: SqlDb;
  defaultDeploymentConfig: DeploymentConfigT;
  tenantId: string;
  key: string;
  lane: string;
  hardeningProfile: "baseline" | "hardened";
}): Promise<string> {
  if (input.skip) {
    return "";
  }
  return buildSandboxPrompt({
    hardeningProfile: input.hardeningProfile,
    attachment: await resolveSandboxAttachmentSummary(input),
  });
}

export async function touchSandboxAttachmentActivity(input: {
  db: SqlDb;
  tenantId: string;
  metadata: Record<string, unknown> | undefined;
  logger?: { warn: (message: string, fields?: Record<string, unknown>) => void };
}): Promise<void> {
  const key = readRecordString(input.metadata, "work_session_key");
  if (!key) {
    return;
  }

  const lane = readRecordString(input.metadata, "work_lane") ?? "main";
  try {
    await new ManagedDesktopAttachmentService({
      db: input.db,
    }).touchLaneActivity({
      tenantId: input.tenantId,
      key,
      lane,
      sourceClientDeviceId: readRecordString(input.metadata, "source_client_device_id"),
      attachedNodeId: readRecordString(input.metadata, "attached_node_id"),
    });
  } catch (error) {
    input.logger?.warn("agents.sandbox_activity_touch_failed", {
      tenant_id: input.tenantId,
      key,
      lane,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
