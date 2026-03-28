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
import { resolveExecutionConversationKind } from "./tool-execution-conversation.js";

type SandboxToolExecutorContext = WorkboardToolExecutorContext & {
  deploymentConfig?: DeploymentConfigT;
};

async function requireCurrentConversationScope(
  context: SandboxToolExecutorContext,
  audit?: ToolExecutionAudit,
): Promise<{ key: string }> {
  const executionConversation = await resolveExecutionConversationKind({
    db: context.workspaceLease?.db,
    tenantId: context.workspaceLease?.tenantId,
    audit,
  });
  if (!executionConversation.conversationKey) {
    throw new Error("sandbox tools require an active work conversation");
  }
  return {
    key: executionConversation.conversationKey,
  };
}

function resolveDefaultDeploymentConfig(config: DeploymentConfigT | undefined): DeploymentConfigT {
  return (
    config ??
    DeploymentConfig.parse({
      server: { publicBaseUrl: DEFAULT_PUBLIC_BASE_URL },
    })
  );
}

async function createSandboxExecutionState(
  context: SandboxToolExecutorContext,
  args: unknown,
  audit?: ToolExecutionAudit,
): Promise<{
  scope: ReturnType<typeof requireWorkScope>;
  record: ReturnType<typeof asRecord>;
  service: ManagedDesktopAttachmentService;
  key: string;
}> {
  const db = requireDb(context);
  const scope = requireWorkScope(context);
  const { key } = await requireCurrentConversationScope(context, audit);
  return {
    scope,
    record: asRecord(args),
    service: new ManagedDesktopAttachmentService({
      db,
      defaultDeploymentConfig: resolveDefaultDeploymentConfig(context.deploymentConfig),
    }),
    key,
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
      const { service, scope, key } = await createSandboxExecutionState(context, args, audit);
      return jsonResult(
        toolCallId,
        await service.getCurrentAttachmentSummary({
          tenantId: scope.tenant_id,
          key,
        }),
      );
    }
    case "sandbox.request": {
      const { service, scope, key, record } = await createSandboxExecutionState(
        context,
        args,
        audit,
      );
      const attachment = await service.requestManagedDesktop({
        tenantId: scope.tenant_id,
        key,
        label: readString(record, "label"),
      });
      if (!attachment) {
        throw new Error("no managed desktop host is currently available");
      }
      return jsonResult(toolCallId, attachment);
    }
    case "sandbox.release": {
      const { service, scope, key } = await createSandboxExecutionState(context, args, audit);
      return jsonResult(
        toolCallId,
        await service.releaseManagedDesktop({
          tenantId: scope.tenant_id,
          key,
        }),
      );
    }
    case "sandbox.handoff": {
      const { service, scope, key, record } = await createSandboxExecutionState(
        context,
        args,
        audit,
      );
      const targetKey = readString(record, "target_key");
      if (!targetKey) {
        throw new Error("target_key is required");
      }
      return jsonResult(
        toolCallId,
        await service.handoffManagedDesktop({
          tenantId: scope.tenant_id,
          sourceKey: key,
          targetKey,
        }),
      );
    }
    default:
      return undefined;
  }
}
