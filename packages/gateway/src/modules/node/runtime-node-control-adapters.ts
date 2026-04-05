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
          turnId: scope.turnId ?? null,
          turnItemId: scope.turnItemId ?? null,
          workflowRunStepId: scope.workflowRunStepId ?? null,
          policySnapshotId: scope.policySnapshotId ?? null,
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
  const enrichedPairingCache = new Map<string, Promise<NodePairingRequest>>();

  function cacheKeyForPairing(tenantId: string, pairing: NodePairingRequest): string {
    return [
      tenantId,
      String(pairing.pairing_id),
      pairing.status,
      String(pairing.latest_review?.review_id ?? "none"),
    ].join(":");
  }

  async function getEnrichedPairing(
    tenantId: string,
    pairing: NodePairingRequest,
  ): Promise<NodePairingRequest> {
    if (!input.desktopEnvironmentDal || pairing.node.managed_desktop) {
      return pairing;
    }

    const cacheKey = cacheKeyForPairing(tenantId, pairing);
    let cached = enrichedPairingCache.get(cacheKey);
    if (!cached) {
      cached = enrichPairingWithManagedDesktop({
        environmentDal: input.desktopEnvironmentDal,
        tenantId,
        pairing,
      });
      enrichedPairingCache.set(cacheKey, cached);
    }
    return await cached;
  }

  function clearEnrichedPairing(tenantId: string, pairing: NodePairingRequest): void {
    enrichedPairingCache.delete(cacheKeyForPairing(tenantId, pairing));
  }

  return {
    nodePairingDal: input.nodePairingDal,
    createResolvedEvent: async ({ tenantId, pairing, scopedToken }) => {
      const enrichedPairing = await getEnrichedPairing(tenantId, pairing);
      try {
        return (
          await ensurePairingResolvedEvent({
            tenantId,
            pairing: enrichedPairing,
            wsEventDal: input.wsEventDal,
            scopedToken,
          })
        ).event;
      } finally {
        clearEnrichedPairing(tenantId, pairing);
      }
    },
    emitEvent:
      input.emitEvent &&
      ((eventInput) => {
        input.emitEvent?.(eventInput);
      }),
    emitPairingApproved:
      input.emitPairingApproved &&
      (async (eventInput) => {
        const pairing = await getEnrichedPairing(eventInput.tenantId, eventInput.pairing);
        await input.emitPairingApproved?.({
          ...eventInput,
          pairing,
        });
      }),
  };
}
