import { NodeDispatchService, type ResolveNodePairingDeps } from "@tyrum/runtime-node-control";
import type { ProtocolDeps } from "../../ws/protocol.js";
import { dispatchTask } from "../../ws/protocol.js";
import { ensurePairingResolvedEvent } from "../../ws/stable-events.js";
import type { NodePairingDal } from "./pairing-dal.js";
import type { WsEventDal } from "../ws-event/dal.js";
import type { NodePairingRequest, WsEventEnvelope } from "@tyrum/contracts";
import type { DesktopEnvironmentDal } from "../desktop-environments/dal.js";
import { enrichPairingWithManagedDesktop } from "../desktop-environments/managed-desktop-reference.js";

export function createNodeDispatchServiceFromProtocolDeps(deps: ProtocolDeps): NodeDispatchService {
  return new NodeDispatchService({
    dispatchTask: async (action, scope, nodeId) =>
      await dispatchTask(
        action,
        {
          tenantId: scope.tenantId ?? "default",
          runId: scope.runId,
          stepId: scope.stepId,
          attemptId: scope.attemptId,
        },
        deps,
        nodeId,
      ),
    taskResults: deps.taskResults,
  });
}

export function createResolveNodePairingDeps(input: {
  nodePairingDal: NodePairingDal;
  desktopEnvironmentDal?: DesktopEnvironmentDal;
  wsEventDal?: WsEventDal;
  emitEvent?: (input: { tenantId: string; event: WsEventEnvelope }) => void;
  emitPairingApproved?: (input: {
    tenantId: string;
    pairing: NodePairingRequest;
    nodeId: string;
    scopedToken: string;
  }) => Promise<void> | void;
}): ResolveNodePairingDeps {
  return {
    nodePairingDal: input.nodePairingDal,
    createResolvedEvent: async ({ tenantId, pairing, scopedToken }) => {
      const enrichedPairing = await enrichPairingWithManagedDesktop({
        environmentDal: input.desktopEnvironmentDal,
        tenantId,
        pairing,
      });
      return (
        await ensurePairingResolvedEvent({
          tenantId,
          pairing: enrichedPairing,
          wsEventDal: input.wsEventDal,
          scopedToken,
        })
      ).event;
    },
    emitEvent:
      input.emitEvent &&
      ((eventInput) => {
        input.emitEvent?.(eventInput);
      }),
    emitPairingApproved:
      input.emitPairingApproved &&
      (async (eventInput) => {
        const pairing = await enrichPairingWithManagedDesktop({
          environmentDal: input.desktopEnvironmentDal,
          tenantId: eventInput.tenantId,
          pairing: eventInput.pairing,
        });
        await input.emitPairingApproved?.({
          ...eventInput,
          pairing,
        });
      }),
  };
}
