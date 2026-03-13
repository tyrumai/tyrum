import type {
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
  WorkScope,
} from "@tyrum/schemas";
import { WorkboardDal } from "../../workboard/dal.js";
import { ChannelOutboxDal } from "../../channels/outbox-dal.js";
import { DEFAULT_CHANNEL_ACCOUNT_ID, parseChannelSourceKey } from "../../channels/interface.js";
import { SessionSendPolicyOverrideDal } from "../../channels/send-policy-override-dal.js";
import { coerceRecord } from "../../util/coerce.js";
import type { ApprovalDal } from "../../approval/dal.js";
import { broadcastApprovalUpdated } from "../../approval/update-broadcast.js";
import type { PolicyService } from "../../policy/service.js";
import { createReviewedApproval } from "../../review/review-init.js";
import type { GatewayContainer } from "../../../container.js";
import type { ProtocolDeps } from "../../../ws/protocol.js";

export type AutomationTurnMetadata = {
  schedule_id?: string;
  watcher_key?: string;
  schedule_kind?: "heartbeat" | "cron";
  fired_at?: string;
  previous_fired_at?: string | null;
  cadence?: unknown;
  delivery_mode?: "quiet" | "notify";
  instruction?: string;
  seeded_default?: boolean;
};

export function resolveAutomationMetadata(
  metadata: Record<string, unknown> | undefined,
): AutomationTurnMetadata | undefined {
  const automation = coerceRecord(metadata?.["automation"]);
  if (!automation) return undefined;

  const kindRaw = automation["schedule_kind"];
  const deliveryModeRaw = automation["delivery_mode"];
  const scheduleKind = kindRaw === "heartbeat" || kindRaw === "cron" ? kindRaw : undefined;
  const deliveryMode =
    deliveryModeRaw === "quiet" || deliveryModeRaw === "notify" ? deliveryModeRaw : undefined;
  if (!scheduleKind) return undefined;

  return {
    schedule_id:
      typeof automation["schedule_id"] === "string" ? automation["schedule_id"] : undefined,
    watcher_key:
      typeof automation["watcher_key"] === "string" ? automation["watcher_key"] : undefined,
    schedule_kind: scheduleKind,
    fired_at: typeof automation["fired_at"] === "string" ? automation["fired_at"] : undefined,
    previous_fired_at:
      typeof automation["previous_fired_at"] === "string" ||
      automation["previous_fired_at"] === null
        ? (automation["previous_fired_at"] as string | null)
        : undefined,
    cadence: automation["cadence"],
    delivery_mode: deliveryMode,
    instruction:
      typeof automation["instruction"] === "string" ? automation["instruction"] : undefined,
    seeded_default: automation["seeded_default"] === true,
  };
}

export async function buildAutomationDigest(input: {
  container: GatewayContainer;
  scope: WorkScope;
  automation: AutomationTurnMetadata;
}): Promise<string> {
  const workboard = new WorkboardDal(input.container.db, input.container.redactionEngine);
  const [itemsResult, signalsResult, activity, pendingApprovals, recentEvents] = await Promise.all([
    workboard.listItems({
      scope: input.scope,
      statuses: ["doing", "blocked", "ready", "backlog"],
      limit: 10,
    }),
    workboard.listSignals({
      scope: input.scope,
      statuses: ["active"],
      limit: 10,
    }),
    workboard.getScopeActivity({ scope: input.scope }),
    input.container.db.all<{
      approval_id: string;
      kind: string;
      prompt: string;
      created_at: string;
    }>(
      `SELECT approval_id, kind, prompt, created_at
         FROM approvals
         WHERE tenant_id = ?
           AND agent_id = ?
           AND workspace_id = ?
           AND status IN ('queued', 'reviewing', 'awaiting_human')
         ORDER BY created_at DESC
         LIMIT 10`,
      [input.scope.tenant_id, input.scope.agent_id, input.scope.workspace_id],
    ),
    input.automation.previous_fired_at
      ? input.container.db.all<{
          work_item_id: string;
          title: string;
          kind: string;
          created_at: string;
        }>(
          `SELECT e.work_item_id, i.title, e.kind, e.created_at
             FROM work_item_events e
             JOIN work_items i
               ON i.tenant_id = e.tenant_id
              AND i.work_item_id = e.work_item_id
             WHERE i.tenant_id = ?
               AND i.agent_id = ?
               AND i.workspace_id = ?
               AND e.created_at > ?
             ORDER BY e.created_at DESC
             LIMIT 10`,
          [
            input.scope.tenant_id,
            input.scope.agent_id,
            input.scope.workspace_id,
            input.automation.previous_fired_at,
          ],
        )
      : Promise.resolve([]),
  ]);

  const lines: string[] = [];
  lines.push("Automation digest:");
  lines.push(
    `- Schedule kind: ${input.automation.schedule_kind ?? "unknown"}${input.automation.seeded_default ? " (seeded default)" : ""}`,
  );
  lines.push(`- Last active session: ${activity?.last_active_session_key ?? "none"}`);
  lines.push(`- Active work items: ${String(itemsResult.items.length)}`);
  for (const item of itemsResult.items.slice(0, 5)) {
    lines.push(`  - [${item.status}] ${item.title}`);
  }
  lines.push(`- Active signals: ${String(signalsResult.signals.length)}`);
  for (const signal of signalsResult.signals.slice(0, 5)) {
    lines.push(`  - ${signal.trigger_kind} (${signal.signal_id})`);
  }
  lines.push(`- Pending approvals: ${String(pendingApprovals.length)}`);
  for (const approval of pendingApprovals.slice(0, 5)) {
    lines.push(`  - ${approval.kind}: ${approval.prompt}`);
  }
  if (recentEvents.length > 0) {
    lines.push("- Recent work item events since previous automation run:");
    for (const event of recentEvents.slice(0, 5)) {
      lines.push(`  - ${event.created_at}: ${event.kind} on ${event.title}`);
    }
  }

  return lines.join("\n");
}

export async function maybeDeliverAutomationReply(
  deps: {
    container: GatewayContainer;
    tenantId: string;
    agentId: string;
    workspaceId: string;
    policyService: PolicyService;
    approvalDal: ApprovalDal;
    protocolDeps?: ProtocolDeps;
  },
  input: {
    turnInput: AgentTurnRequestT;
    response: AgentTurnResponseT;
    automation: AutomationTurnMetadata;
  },
): Promise<void> {
  const tenantId = deps.tenantId;
  const agentKey = input.turnInput.agent_key?.trim() || deps.agentId;
  const workspaceKey = input.turnInput.workspace_key?.trim() || deps.workspaceId;
  const agentId = await deps.container.identityScopeDal.ensureAgentId(tenantId, agentKey);
  const workspaceId = await deps.container.identityScopeDal.ensureWorkspaceId(
    tenantId,
    workspaceKey,
  );
  const workboard = new WorkboardDal(deps.container.db);
  const activity = await workboard.getScopeActivity({
    scope: { tenant_id: tenantId, agent_id: agentId, workspace_id: workspaceId },
  });
  const targetSessionKey = activity?.last_active_session_key?.trim();
  if (!targetSessionKey) return;
  const sendOverride = await new SessionSendPolicyOverrideDal(deps.container.db).get({
    tenant_id: tenantId,
    key: targetSessionKey,
  });
  if (sendOverride?.send_policy === "off") return;

  const route = await deps.container.db.get<{
    inbox_id: number;
    tenant_id: string;
    source: string;
    thread_id: string;
    workspace_id: string;
    session_id: string;
    channel_thread_id: string;
  }>(
    `SELECT inbox_id, tenant_id, source, thread_id, workspace_id, session_id, channel_thread_id
     FROM channel_inbox
     WHERE tenant_id = ? AND key = ?
     ORDER BY received_at_ms DESC, inbox_id DESC
     LIMIT 1`,
    [tenantId, targetSessionKey],
  );
  if (!route) return;

  const outbox = new ChannelOutboxDal(deps.container.db);
  const dedupeKey = [
    "automation.reply",
    input.automation.schedule_id ?? "unknown",
    input.automation.fired_at ?? "unknown",
    input.response.session_id,
  ].join(":");
  const existing = await outbox.getByDedupeKey({
    tenant_id: route.tenant_id,
    dedupe_key: dedupeKey,
  });
  if (existing) return;

  let decision: "allow" | "deny" | "require_approval" = "allow";
  let policySnapshotId: string | undefined;
  if (deps.policyService.isEnabled()) {
    try {
      const parsedSource = parseChannelSourceKey(route.source);
      const matchTarget =
        parsedSource.accountId === DEFAULT_CHANNEL_ACCOUNT_ID
          ? `${parsedSource.connector}:${route.thread_id}`
          : `${parsedSource.connector}:${parsedSource.accountId}:${route.thread_id}`;
      const evaluation = await deps.policyService.evaluateConnectorAction({
        tenantId,
        agentId,
        workspaceId,
        matchTarget,
      });
      decision = evaluation.decision;
      policySnapshotId = evaluation.policy_snapshot?.policy_snapshot_id;
    } catch {
      // Intentional: fail closed if connector policy evaluation fails.
      decision = "require_approval";
    }

    if (deps.policyService.isObserveOnly()) {
      decision = "allow";
    }
  }

  if (sendOverride?.send_policy === "on") {
    decision = "allow";
  }

  if (
    decision === "deny" &&
    deps.policyService.isEnabled() &&
    !deps.policyService.isObserveOnly()
  ) {
    return;
  }

  let approvalId: string | undefined;
  if (decision === "require_approval") {
    const approval = await createReviewedApproval({
      approvalDal: deps.approvalDal,
      policyService: deps.policyService,
      emitUpdate: async (createdApproval) => {
        await broadcastApprovalUpdated({
          tenantId,
          approval: createdApproval,
          protocolDeps: deps.protocolDeps,
        });
      },
      params: {
        tenantId,
        agentId,
        workspaceId,
        approvalKey: `connector:automation.reply:${route.source}:${route.thread_id}:${dedupeKey}`,
        kind: "connector.send",
        prompt: `Approve sending an automation reply`,
        motivation: "The automation wants to send a reply to an external connector thread.",
        context: {
          source: route.source,
          thread_id: route.thread_id,
          inbox_id: route.inbox_id,
          key: targetSessionKey,
          policy_snapshot_id: policySnapshotId,
          automation: {
            schedule_id: input.automation.schedule_id,
            schedule_kind: input.automation.schedule_kind,
            fired_at: input.automation.fired_at,
          },
          preview: input.response.reply,
        },
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
    });
    approvalId = approval.approval_id;
  }

  await outbox.enqueue({
    tenant_id: route.tenant_id,
    inbox_id: route.inbox_id,
    source: route.source,
    thread_id: route.thread_id,
    dedupe_key: dedupeKey,
    chunk_index: 0,
    text: input.response.reply,
    approval_id: approvalId ?? null,
    workspace_id: route.workspace_id,
    session_id: route.session_id,
    channel_thread_id: route.channel_thread_id,
  });
}
