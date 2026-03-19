import { NodeDispatchService, type ResolveNodePairingDeps } from "@tyrum/runtime-node-control";
import type { ProtocolDeps } from "../../ws/protocol.js";
import { dispatchTask } from "../../ws/protocol.js";
import { ensurePairingResolvedEvent } from "../../ws/stable-events.js";
import type { NodePairingDal } from "./pairing-dal.js";
import type { WsEventDal } from "../ws-event/dal.js";
import type { NodePairingRequest, WsEventEnvelope } from "@tyrum/contracts";

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
  wsEventDal?: WsEventDal;
  emitEvent?: (input: { tenantId: string; event: WsEventEnvelope }) => void;
  emitPairingApproved?: (input: {
    tenantId: string;
    pairing: NodePairingRequest;
    nodeId: string;
    scopedToken: string;
  }) => void;
}): ResolveNodePairingDeps {
  return {
    nodePairingDal: input.nodePairingDal,
    createResolvedEvent: async ({ tenantId, pairing, scopedToken }) =>
      (
        await ensurePairingResolvedEvent({
          tenantId,
          pairing,
          wsEventDal: input.wsEventDal,
          scopedToken,
        })
      ).event,
    emitEvent:
      input.emitEvent &&
      ((eventInput) => {
        input.emitEvent?.(eventInput);
      }),
    emitPairingApproved: input.emitPairingApproved,
  };
}
