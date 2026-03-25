import type { Approval } from "@tyrum/contracts";
import type { ApprovalRow } from "./dal.js";
import { toApprovalContract } from "./to-contract.js";
import type { ProtocolDeps } from "../../ws/protocol.js";
import { ensureApprovalUpdatedEvent } from "../../ws/stable-events.js";
import { APPROVAL_WS_AUDIENCE } from "../../ws/audience.js";
import { broadcastWsEvent } from "../../ws/broadcast.js";
import { enrichApprovalWithManagedDesktop } from "../desktop-environments/managed-desktop-reference.js";

export async function broadcastApprovalUpdated(input: {
  tenantId: string;
  approval: ApprovalRow;
  protocolDeps?: Pick<
    ProtocolDeps,
    | "connectionManager"
    | "wsEventDal"
    | "logger"
    | "maxBufferedBytes"
    | "cluster"
    | "desktopEnvironmentDal"
  >;
}): Promise<Approval | undefined> {
  const approval = toApprovalContract(input.approval);
  if (!approval || !input.protocolDeps) {
    return approval;
  }
  const enrichedApproval = await enrichApprovalWithManagedDesktop({
    environmentDal: input.protocolDeps.desktopEnvironmentDal,
    tenantId: input.tenantId,
    approval,
  });

  const persisted = await ensureApprovalUpdatedEvent({
    tenantId: input.tenantId,
    approval: enrichedApproval,
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
  return enrichedApproval;
}
