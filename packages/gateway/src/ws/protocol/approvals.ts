import type { WsRequestEnvelope } from "@tyrum/schemas";
import { hasAnyRequiredScope } from "../../modules/auth/scopes.js";
import type { ProtocolDeps } from "./types.js";

/**
 * Send an approval.request to the first connected operator client.
 *
 * Approval requests are not capability-scoped; any connected client
 * with a human operator can respond as long as they are authorized to do so.
 */
export function requestApproval(
  approval: {
    approval_id: number;
    plan_id: string;
    step_index: number;
    prompt: string;
    context?: unknown;
    expires_at?: string | null;
  },
  deps: ProtocolDeps,
): void {
  const requestId = `approval-${String(approval.approval_id)}`;
  const message: WsRequestEnvelope = {
    request_id: requestId,
    type: "approval.request",
    payload: approval,
  };
  const payload = JSON.stringify(message);

  for (const peer of deps.connectionManager.allClients()) {
    const authClaims = peer.auth_claims;
    if (!authClaims) continue;
    if (peer.role !== "client") continue;
    if (
      authClaims.token_kind === "device" &&
      !hasAnyRequiredScope(authClaims, ["operator.approvals"])
    )
      continue;

    peer.ws.send(payload);
    if (deps.cluster) {
      void deps.cluster.outboxDal
        .enqueue("ws.broadcast", {
          source_edge_id: deps.cluster.edgeId,
          skip_local: true,
          message,
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          deps.logger?.error("outbox.enqueue_failed", {
            topic: "ws.broadcast",
            error: message,
          });
        });
    }
    return;
  }

  if (deps.cluster) {
    void deps.cluster.outboxDal.enqueue("ws.broadcast", { message }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.error("outbox.enqueue_failed", {
        topic: "ws.broadcast",
        error: message,
      });
    });
  }
}
