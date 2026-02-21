/**
 * Approval notification interface and implementations.
 *
 * Notifiers push human_confirmation messages to connected clients
 * so operators can approve or deny pending actions.
 */

import type { ProtocolDeps } from "../../ws/protocol.js";
import { publishEvent, requestApproval } from "../../ws/protocol.js";
import { randomUUID } from "node:crypto";
import type { ApprovalRow } from "./dal.js";
import { runIdFromContext, toSchemaApproval } from "./schema.js";

/**
 * An ApprovalNotifier sends a notification about a pending approval
 * to a human operator via some channel.
 */
export interface ApprovalNotifier {
  /** Notify a human operator about a new pending approval. */
  notify(approval: ApprovalRow): void;
}

/**
 * Sends approval notifications over the existing WebSocket protocol
 * using the human_confirmation message type.
 */
export class WsNotifier implements ApprovalNotifier {
  constructor(private readonly protocolDeps: ProtocolDeps) {}

  notify(approval: ApprovalRow): void {
    const nowIso = new Date().toISOString();
    const schemaApproval = toSchemaApproval(approval);

    // Emit an approval.requested event for observability (best-effort).
    publishEvent(
      {
        event_id: randomUUID(),
        type: "approval.requested",
        occurred_at: nowIso,
        payload: { approval: schemaApproval },
      },
      this.protocolDeps,
      { targetRole: "client" },
    );

    const runId = runIdFromContext(approval.context);
    if (runId) {
      publishEvent(
        {
          event_id: randomUUID(),
          type: "run.paused",
          occurred_at: nowIso,
          payload: {
            run_id: runId,
            reason: "approval",
            detail: approval.prompt,
            approval_id: approval.id,
          },
        },
        this.protocolDeps,
        { targetRole: "client" },
      );
    }

    requestApproval(
      {
        approval_id: approval.id,
        plan_id: approval.plan_id,
        step_index: approval.step_index,
        prompt: approval.prompt,
        context: approval.context,
        expires_at: approval.expires_at,
      },
      this.protocolDeps,
    );
  }
}

/**
 * Stub Telegram notifier — will be wired with a real Telegram bot
 * in a later phase. Currently a no-op.
 */
export class TelegramNotifier implements ApprovalNotifier {
  notify(_approval: ApprovalRow): void {
    // Stub: Telegram notification will be implemented when the
    // Telegram bot integration is completed in a later phase.
  }
}
