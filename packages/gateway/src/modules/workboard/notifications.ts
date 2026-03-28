import type { WorkItem, WorkScope } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import type { ApprovalDal } from "../approval/dal.js";
import { broadcastApprovalUpdated } from "../approval/update-broadcast.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import { ChannelOutboxDal } from "../channels/outbox-dal.js";
import { DEFAULT_CHANNEL_ACCOUNT_ID, parseChannelSourceKey } from "../channels/interface.js";
import { ConversationSendPolicyOverrideDal } from "../channels/send-policy-override-dal.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";
import { createReviewedApproval } from "../review/review-init.js";
import { WorkboardDal } from "./dal.js";
import type { ProtocolDeps } from "../../ws/protocol.js";

type WorkItemTerminalState = "blocked" | "done" | "failed";

function isTerminalState(status: WorkItem["status"]): status is WorkItemTerminalState {
  return status === "blocked" || status === "done" || status === "failed";
}

function buildNotificationText(item: WorkItem): string {
  switch (item.status) {
    case "done":
      return `Work item completed: ${item.title}`;
    case "blocked":
      return `Work item blocked: ${item.title}`;
    case "failed":
      return `Work item failed: ${item.title}`;
    default:
      return `Work item updated: ${item.title}`;
  }
}

export async function enqueueWorkItemStateChangeNotification(input: {
  db: SqlDb;
  scope: WorkScope;
  item: WorkItem;
  policyService?: PolicyService;
  approvalDal?: ApprovalDal;
  protocolDeps?: ProtocolDeps;
}): Promise<{ enqueued: boolean; deduped?: boolean; skipped_reason?: string }> {
  if (!isTerminalState(input.item.status)) {
    return { enqueued: false, skipped_reason: "status_not_notifiable" };
  }

  const workboard = new WorkboardDal(input.db);
  const activity = await workboard.getScopeActivity({ scope: input.scope });
  const targetConversationKey =
    activity?.last_active_conversation_key ?? input.item.created_from_conversation_key;

  const tenantId = input.scope.tenant_id === "default" ? DEFAULT_TENANT_ID : input.scope.tenant_id;
  const sendOverride = await new ConversationSendPolicyOverrideDal(input.db).get({
    tenant_id: tenantId,
    key: targetConversationKey,
  });
  if (sendOverride?.send_policy === "off") {
    return { enqueued: false, skipped_reason: "send_policy_off" };
  }

  const route = await input.db.get<{
    inbox_id: number;
    tenant_id: string;
    source: string;
    thread_id: string;
    workspace_id: string;
    conversation_id: string;
    channel_thread_id: string;
  }>(
    `SELECT inbox_id, tenant_id, source, thread_id, workspace_id, conversation_id, channel_thread_id
     FROM channel_inbox
     WHERE tenant_id = ? AND key = ?
     ORDER BY received_at_ms DESC, inbox_id DESC
     LIMIT 1`,
    [tenantId, targetConversationKey],
  );

  if (!route) {
    return { enqueued: false, skipped_reason: "no_channel_route" };
  }

  const updatedAtIso = (input.item.updated_at ?? input.item.created_at).trim();
  const dedupeKey = `work.notify:${input.item.work_item_id}:${input.item.status}:${updatedAtIso}`;

  const outbox = new ChannelOutboxDal(input.db);
  const existing = await outbox.getByDedupeKey({ tenant_id: tenantId, dedupe_key: dedupeKey });
  if (existing) {
    return { enqueued: true, deduped: true };
  }

  let decision: "allow" | "deny" | "require_approval" = "allow";
  let policySnapshotId: string | undefined;

  const policyService = input.policyService;
  if (policyService) {
    try {
      const parsedSource = parseChannelSourceKey(route.source);
      const matchTarget =
        parsedSource.accountId === DEFAULT_CHANNEL_ACCOUNT_ID
          ? `${parsedSource.connector}:${route.thread_id}`
          : `${parsedSource.connector}:${parsedSource.accountId}:${route.thread_id}`;
      const evalRes = await policyService.evaluateConnectorAction({
        tenantId,
        agentId: input.scope.agent_id,
        workspaceId: input.scope.workspace_id,
        matchTarget,
      });
      decision = evalRes.decision;
      policySnapshotId = evalRes.policy_snapshot?.policy_snapshot_id;
    } catch {
      // Intentional: fail closed when policy evaluation fails.
      decision = "require_approval";
    }

    if (policyService.isObserveOnly()) {
      decision = "allow";
    }
  }

  if (sendOverride?.send_policy === "on") {
    decision = "allow";
  }

  if (decision === "deny" && policyService && !policyService.isObserveOnly()) {
    return { enqueued: false, skipped_reason: "policy_denied" };
  }

  let approvalId: string | undefined;
  if (decision === "require_approval") {
    if (!input.approvalDal) {
      return { enqueued: false, skipped_reason: "approval_required" };
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const approval = await createReviewedApproval({
      approvalDal: input.approvalDal,
      policyService,
      emitUpdate: async (createdApproval) => {
        await broadcastApprovalUpdated({
          tenantId,
          approval: createdApproval,
          protocolDeps: input.protocolDeps,
        });
      },
      params: {
        tenantId,
        agentId: input.scope.agent_id,
        workspaceId: input.scope.workspace_id,
        approvalKey: `connector:work.notify:${route.source}:${route.thread_id}:${input.item.work_item_id}:${updatedAtIso}`,
        kind: "connector.send",
        prompt: `Approve sending a ${route.source} completion notification`,
        motivation:
          "The system wants to notify the external thread that a tracked work item reached a terminal state.",
        context: {
          source: route.source,
          thread_id: route.thread_id,
          inbox_id: route.inbox_id,
          conversation_key: targetConversationKey,
          policy_snapshot_id: policySnapshotId,
          work_item: {
            work_item_id: input.item.work_item_id,
            status: input.item.status,
            title: input.item.title,
          },
        },
        expiresAt,
      },
    });
    approvalId = approval.approval_id;
  }

  const { deduped } = await outbox.enqueue({
    tenant_id: tenantId,
    inbox_id: route.inbox_id,
    source: route.source,
    thread_id: route.thread_id,
    dedupe_key: dedupeKey,
    chunk_index: 0,
    text: buildNotificationText(input.item),
    approval_id: approvalId ?? null,
    workspace_id: route.workspace_id,
    conversation_id: route.conversation_id,
    channel_thread_id: route.channel_thread_id,
  });

  return { enqueued: true, deduped };
}
