/**
 * Approval notification interface and implementations.
 *
 * Notifiers push human_confirmation messages to connected clients
 * so operators can approve or deny pending actions.
 */

import type { ProtocolDeps } from "../../ws/protocol.js";
import { requestApproval } from "../../ws/protocol.js";
import type { ApprovalRow } from "./dal.js";

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
    requestApproval(
      approval.tenant_id,
      {
        approval_id: approval.approval_id,
        approval_key: approval.approval_key,
        kind: approval.kind,
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
