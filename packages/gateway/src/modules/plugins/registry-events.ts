import {
  canonicalizeToolId,
  type PluginManifest as PluginManifestT,
  WsEventEnvelope,
} from "@tyrum/contracts";
import { randomUUID } from "node:crypto";
import type { GatewayContainer } from "../../container.js";
import { OPERATOR_WS_AUDIENCE } from "../../ws/audience.js";
import { enqueueWsBroadcastMessage } from "../../ws/outbox.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";
import type { Logger } from "../observability/logger.js";
import type { PluginDirKind } from "./directories.js";

const PLUGIN_LIFECYCLE_AUDIT_PLAN_ID = "gateway.plugins.lifecycle";
const PLUGIN_TOOL_INVOKED_AUDIT_PLAN_PREFIX = "gateway.plugins.tool_invoked";

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function emitPluginLifecycleEvent(
  opts: { logger: Logger; container?: GatewayContainer },
  params: {
    kind: "loaded" | "failed";
    plugin?: Pick<PluginManifestT, "id" | "name" | "version">;
    sourceKind: PluginDirKind;
    sourceDir: string;
    toolsCount?: number;
    commandsCount?: number;
    router?: boolean;
    reason?: string;
    error?: string;
  },
): Promise<void> {
  if (!opts.container) return;
  try {
    const occurredAt = new Date().toISOString(),
      action = {
        type: "plugin.lifecycle",
        kind: params.kind,
        plugin_id: params.plugin?.id,
        plugin_name: params.plugin?.name,
        plugin_version: params.plugin?.version,
        source_kind: params.sourceKind,
        source_dir: params.sourceDir,
        tools_count: params.toolsCount,
        commands_count: params.commandsCount,
        router: params.router,
        reason: params.reason,
        error: params.error,
      };
    await opts.container.eventLog.appendNext(
      {
        tenantId: DEFAULT_TENANT_ID,
        replayId: randomUUID(),
        planKey: PLUGIN_LIFECYCLE_AUDIT_PLAN_ID,
        occurredAt,
        action,
      },
      async (tx, auditEvent) => {
        const evt: WsEventEnvelope = {
          event_id: randomUUID(),
          type: "plugin.lifecycle",
          occurred_at: occurredAt,
          scope: { kind: "global" },
          payload: {
            kind: params.kind,
            plugin: {
              id: params.plugin?.id,
              name: params.plugin?.name,
              version: params.plugin?.version,
              source_kind: params.sourceKind,
              source_dir: params.sourceDir,
              tools_count: params.toolsCount,
              commands_count: params.commandsCount,
              router: params.router,
            },
            reason: params.reason,
            error: params.error,
            audit: {
              plan_id: PLUGIN_LIFECYCLE_AUDIT_PLAN_ID,
              step_index: auditEvent.stepIndex,
              event_id: auditEvent.id,
            },
          },
        };
        await enqueueWsBroadcastMessage(tx, DEFAULT_TENANT_ID, evt, OPERATOR_WS_AUDIENCE);
      },
    );
  } catch (err) {
    opts.logger.warn("plugins.lifecycle_emit_failed", {
      plugin_id: params.plugin?.id,
      source_dir: params.sourceDir,
      kind: params.kind,
      reason: params.reason,
      error: errorMessage(err),
    });
  }
}

export async function emitPluginToolInvokedEvent(
  opts: { logger: Logger; container?: GatewayContainer },
  params: {
    pluginId: string;
    pluginVersion: string;
    toolId: string;
    toolCallId: string;
    agentId: string;
    workspaceId: string;
    auditPlanId?: string;
    conversationId?: string;
    channel?: string;
    threadId?: string;
    policySnapshotId?: string;
    outcome: "succeeded" | "failed";
    error?: string;
    durationMs: number;
  },
): Promise<void> {
  const sourcePlanId = params.auditPlanId?.trim();
  if (!opts.container || !sourcePlanId) return;
  try {
    const auditPlanId = `${PLUGIN_TOOL_INVOKED_AUDIT_PLAN_PREFIX}:${sourcePlanId}`,
      occurredAt = new Date().toISOString();
    const publicToolId = canonicalizeToolId(params.toolId);
    const action = {
      type: "plugin_tool.invoked",
      plugin_id: params.pluginId,
      plugin_version: params.pluginVersion,
      tool_id: publicToolId,
      tool_call_id: params.toolCallId,
      agent_id: params.agentId,
      workspace_id: params.workspaceId,
      conversation_id: params.conversationId,
      channel: params.channel,
      thread_id: params.threadId,
      policy_snapshot_id: params.policySnapshotId,
      outcome: params.outcome,
      duration_ms: params.durationMs,
      error: params.error,
    };
    await opts.container.eventLog.appendNext(
      {
        tenantId: DEFAULT_TENANT_ID,
        replayId: randomUUID(),
        planKey: auditPlanId,
        occurredAt,
        action,
      },
      async (tx, auditEvent) => {
        const evt: WsEventEnvelope = {
          event_id: randomUUID(),
          type: "plugin_tool.invoked",
          occurred_at: occurredAt,
          scope: { kind: "agent", agent_id: params.agentId },
          payload: {
            plugin_id: params.pluginId,
            plugin_version: params.pluginVersion,
            tool_id: publicToolId,
            tool_call_id: params.toolCallId,
            agent_id: params.agentId,
            workspace_id: params.workspaceId,
            conversation_id: params.conversationId,
            channel: params.channel,
            thread_id: params.threadId,
            policy_snapshot_id: params.policySnapshotId,
            outcome: params.outcome,
            duration_ms: params.durationMs,
            error: params.error,
            audit: {
              plan_id: auditPlanId,
              step_index: auditEvent.stepIndex,
              event_id: auditEvent.id,
            },
          },
        };
        await enqueueWsBroadcastMessage(tx, DEFAULT_TENANT_ID, evt, OPERATOR_WS_AUDIENCE);
      },
    );
  } catch (err) {
    opts.logger.warn("plugins.tool_invoked_emit_failed", {
      plugin_id: params.pluginId,
      tool_id: canonicalizeToolId(params.toolId),
      tool_call_id: params.toolCallId,
      plan_id: sourcePlanId,
      audit_plan_id: `${PLUGIN_TOOL_INVOKED_AUDIT_PLAN_PREFIX}:${sourcePlanId}`,
      error: errorMessage(err),
    });
  }
}
