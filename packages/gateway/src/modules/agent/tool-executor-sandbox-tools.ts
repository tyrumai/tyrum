import {
  DEFAULT_PUBLIC_BASE_URL,
  DeploymentConfig,
  type DeploymentConfig as DeploymentConfigT,
} from "@tyrum/contracts";
import { ManagedDesktopAttachmentService } from "../desktop-environments/managed-desktop-attachment-service.js";
import type { ToolExecutionAudit, ToolResult } from "./tool-executor-shared.js";
import {
  asRecord,
  jsonResult,
  readString,
  requireDb,
  requireWorkScope,
  type WorkboardToolExecutorContext,
} from "./tool-executor-workboard-tools-shared.js";

type SandboxToolExecutorContext = WorkboardToolExecutorContext & {
  deploymentConfig?: DeploymentConfigT;
};

function requireCurrentLane(audit?: ToolExecutionAudit): { key: string; lane: string } {
  const key = audit?.work_session_key?.trim();
  const lane = audit?.work_lane?.trim() || "main";
  if (!key) {
    throw new Error("sandbox tools require an active work_session_key");
  }
  return { key, lane };
}

function resolveDefaultDeploymentConfig(config: DeploymentConfigT | undefined): DeploymentConfigT {
  return (
    config ??
    DeploymentConfig.parse({
      server: { publicBaseUrl: DEFAULT_PUBLIC_BASE_URL },
    })
  );
}

function createSandboxExecutionState(
  context: SandboxToolExecutorContext,
  args: unknown,
  audit?: ToolExecutionAudit,
): {
  scope: ReturnType<typeof requireWorkScope>;
  record: ReturnType<typeof asRecord>;
  service: ManagedDesktopAttachmentService;
  key: string;
  lane: string;
} {
  const db = requireDb(context);
  const scope = requireWorkScope(context);
  const { key, lane } = requireCurrentLane(audit);
  return {
    scope,
    record: asRecord(args),
    service: new ManagedDesktopAttachmentService({
      db,
      defaultDeploymentConfig: resolveDefaultDeploymentConfig(context.deploymentConfig),
    }),
    key,
    lane,
  };
}

export async function executeSandboxTool(
  context: SandboxToolExecutorContext,
  toolId: string,
  toolCallId: string,
  args: unknown,
  audit?: ToolExecutionAudit,
): Promise<ToolResult | undefined> {
  if (!toolId.startsWith("sandbox.")) {
    return undefined;
  }

  switch (toolId) {
    case "sandbox.current": {
      const { service, scope, key, lane } = createSandboxExecutionState(context, args, audit);
      return jsonResult(
        toolCallId,
        await service.getCurrentAttachmentSummary({
          tenantId: scope.tenant_id,
          key,
          lane,
        }),
      );
    }
    case "sandbox.request": {
      const { service, scope, key, lane, record } = createSandboxExecutionState(
        context,
        args,
        audit,
      );
      const attachment = await service.requestManagedDesktop({
        tenantId: scope.tenant_id,
        key,
        lane,
        label: readString(record, "label"),
      });
      if (!attachment) {
        throw new Error("no managed desktop host is currently available");
      }
      return jsonResult(toolCallId, attachment);
    }
    case "sandbox.release": {
      const { service, scope, key, lane } = createSandboxExecutionState(context, args, audit);
      return jsonResult(
        toolCallId,
        await service.releaseManagedDesktop({
          tenantId: scope.tenant_id,
          key,
          lane,
        }),
      );
    }
    case "sandbox.handoff": {
      const { service, scope, key, lane, record } = createSandboxExecutionState(
        context,
        args,
        audit,
      );
      const targetKey = readString(record, "target_key");
      const targetLane = readString(record, "target_lane");
      if (!targetKey || !targetLane) {
        throw new Error("target_key and target_lane are required");
      }
      return jsonResult(
        toolCallId,
        await service.handoffManagedDesktop({
          tenantId: scope.tenant_id,
          sourceKey: key,
          sourceLane: lane,
          targetKey,
          targetLane: targetLane as "main" | "cron" | "heartbeat" | "subagent",
        }),
      );
    }
    default:
      return undefined;
  }
}
