import type { Approval } from "@tyrum/schemas";
import type { ApprovalRow } from "./dal.js";
import { toApprovalContract } from "./to-contract.js";
import type { ProtocolDeps } from "../../ws/protocol.js";
import { ensureApprovalResolvedEvent } from "../../ws/stable-events.js";
import { APPROVAL_WS_AUDIENCE } from "../../ws/audience.js";
import { broadcastWsEvent } from "../../ws/broadcast.js";

export async function broadcastApprovalUpdated(input: {
  tenantId: string;
  approval: ApprovalRow;
  protocolDeps?: Pick<
    ProtocolDeps,
    "connectionManager" | "wsEventDal" | "logger" | "maxBufferedBytes" | "cluster"
  >;
}): Promise<Approval | undefined> {
  const approval = toApprovalContract(input.approval);
  if (!approval || !input.protocolDeps) {
    return approval;
  }

  const persisted = await ensureApprovalResolvedEvent({
    tenantId: input.tenantId,
    approval,
    wsEventDal: input.protocolDeps.wsEventDal,
  });
  broadcastWsEvent(
    input.tenantId,
    persisted.event,
    {
      connectionManager: input.protocolDeps.connectionManager,
      cluster: input.protocolDeps.cluster,
      logger: input.protocolDeps.logger,
      maxBufferedBytes: input.protocolDeps.maxBufferedBytes,
    },
    APPROVAL_WS_AUDIENCE,
  );
  return approval;
}
