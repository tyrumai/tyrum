import type { WsRequestEnvelope } from "@tyrum/schemas";
import { hasAnyRequiredScope } from "../../modules/auth/scopes.js";
import { APPROVAL_PROMPT_WS_AUDIENCE } from "../audience.js";
import type { ProtocolDeps } from "./types.js";

/**
 * Send an approval.request to the first connected operator client.
 *
 * Approval requests are not capability-scoped; any connected client
 * with a human operator can respond as long as they are authorized to do so.
 */
export function requestApproval(
  tenantId: string,
  approval: {
    approval_id: string;
    approval_key: string;
    kind: string;
    prompt: string;
    context?: unknown;
    expires_at?: string | null;
  },
  deps: ProtocolDeps,
): void {
  const normalizedTenantId = tenantId.trim();
  if (normalizedTenantId.length === 0) {
    throw new Error("tenantId is required");
  }

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
    if (authClaims.tenant_id !== normalizedTenantId) continue;
    if (
      authClaims.token_kind === "device" &&
      !hasAnyRequiredScope(authClaims, ["operator.approvals"])
    )
      continue;

    try {
      peer.ws.send(payload);
    } catch (err) {
      void err;
      continue;
    }
    if (deps.cluster) {
      void deps.cluster.outboxDal
        .enqueue(normalizedTenantId, "ws.broadcast", {
          source_edge_id: deps.cluster.edgeId,
          skip_local: true,
          message,
          audience: APPROVAL_PROMPT_WS_AUDIENCE,
        })
        .catch((err) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          deps.logger?.error("outbox.enqueue_failed", {
            topic: "ws.broadcast",
            error: errorMessage,
          });
        });
    }
    return;
  }

  if (deps.cluster) {
    void deps.cluster.outboxDal
      .enqueue(normalizedTenantId, "ws.broadcast", {
        source_edge_id: deps.cluster.edgeId,
        message,
        audience: APPROVAL_PROMPT_WS_AUDIENCE,
      })
      .catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        deps.logger?.error("outbox.enqueue_failed", {
          topic: "ws.broadcast",
          error: errorMessage,
        });
      });
  }
}
