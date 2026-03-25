import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  requiredCapabilityDescriptorForAction,
} from "@tyrum/contracts";
import type { ActionPrimitive, CapabilityDescriptor, WsRequestEnvelope } from "@tyrum/contracts";
import { toolIdForCapabilityDescriptor } from "../../app/modules/node/capability-tool-id.js";
import { canonicalizeNodeDispatchMatchTarget } from "../../app/modules/policy/match-target.js";
import type { ConnectionDirectoryRow } from "../../app/modules/backplane/connection-directory.js";
import type { ConnectedClient } from "../connection-manager.js";
import { upsertAttemptExecutorMetadata } from "./attempt-executor-metadata.js";
import { withClusterTaskOrigin } from "./cluster-task-result-routing.js";
import {
  NoCapableClientError,
  NoCapableNodeError,
  NodeDispatchDeniedError,
  NodeNotCapableError,
  NodeNotConnectedError,
  NodeNotPairedError,
  NodeNotReadyError,
  UnknownNodeError,
} from "./errors.js";
import type { ProtocolDeps } from "./types.js";
type DispatchScope = {
  tenantId: string;
  runId: string;
  stepId: string;
  attemptId: string;
};

type PolicyDispatchState = {
  policySnapshotId?: string;
  nodeDispatchAllowed: boolean;
  trace?: { policy_snapshot_id?: string; policy_decision?: string };
};

function hasCapability(
  capabilities: readonly CapabilityDescriptor[],
  capabilityId: string,
): boolean {
  return capabilities.some((capability) => capability.id === capabilityId);
}

async function resolvePolicyDispatchState(
  deps: ProtocolDeps,
  _scope: DispatchScope,
  toolId: string,
  toolMatchTarget: string,
  policyEnabled: boolean,
  policyEvalPromise:
    | Promise<{ decision: string; policy_snapshot?: { policy_snapshot_id?: string } }>
    | undefined,
): Promise<PolicyDispatchState> {
  const policyEvaluation = policyEvalPromise
    ? await policyEvalPromise.catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger?.error("policy.evaluate_failed", {
          tool_id: toolId,
          tool_match_target: toolMatchTarget,
          error: message,
        });
        return { decision: "deny" as const, policy_snapshot: undefined };
      })
    : undefined;
  const policyDecision = policyEvaluation?.decision;
  const policySnapshotId = policyEvaluation?.policy_snapshot?.policy_snapshot_id;
  const shouldEnforcePolicy = policyEnabled && !(deps.policyService?.isObserveOnly() ?? false);
  return {
    policySnapshotId,
    nodeDispatchAllowed: !shouldEnforcePolicy || policyDecision !== "deny",
    trace:
      policySnapshotId || policyDecision
        ? {
            policy_snapshot_id: policySnapshotId,
            policy_decision: policyDecision,
          }
        : undefined,
  };
}

async function dispatchToClusterNode(
  deps: ProtocolDeps,
  scope: DispatchScope,
  action: ActionPrimitive,
  target: ConnectionDirectoryRow,
  trace?: { policy_snapshot_id?: string; policy_decision?: string },
): Promise<string> {
  const cluster = deps.cluster;
  if (!cluster) {
    throw new Error("cluster dispatch is not configured");
  }

  if (!target.device_id) {
    throw new Error("cluster target is missing device_id");
  }

  await upsertAttemptExecutorMetadata(deps, scope.attemptId, {
    tenantId: scope.tenantId,
    nodeId: target.device_id,
    connectionId: target.connection_id,
    edgeId: target.edge_id,
  });

  const requestId = `task-${crypto.randomUUID()}`;
  const message: WsRequestEnvelope = {
    request_id: requestId,
    type: "task.execute",
    payload: {
      turn_id: scope.runId,
      step_id: scope.stepId,
      attempt_id: scope.attemptId,
      action,
    },
    trace: withClusterTaskOrigin(trace, cluster.edgeId),
  };

  await cluster.outboxDal.enqueue(
    scope.tenantId,
    "ws.direct",
    { connection_id: target.connection_id, message },
    { targetEdgeId: target.edge_id },
  );
  return requestId;
}

async function dispatchToLocalNode(
  deps: ProtocolDeps,
  scope: DispatchScope,
  action: ActionPrimitive,
  target: ConnectedClient,
  trace?: { policy_snapshot_id?: string; policy_decision?: string },
): Promise<string> {
  if (target.role !== "node") {
    throw new Error("local target must be a node");
  }

  const nodeId = target.device_id ?? target.id;
  await upsertAttemptExecutorMetadata(deps, scope.attemptId, {
    tenantId: scope.tenantId,
    nodeId,
    connectionId: target.id,
    edgeId: deps.cluster?.edgeId,
  });

  const requestId = `task-${crypto.randomUUID()}`;
  deps.taskResults?.associate(requestId, target.id);
  const message: WsRequestEnvelope = {
    request_id: requestId,
    type: "task.execute",
    payload: {
      turn_id: scope.runId,
      step_id: scope.stepId,
      attempt_id: scope.attemptId,
      action,
    },
    trace,
  };
  target.ws.send(JSON.stringify(message));
  deps.connectionManager.recordDispatchedAttemptExecutor(scope.attemptId, nodeId);
  return requestId;
}

async function resolveTargetedDispatch(
  action: ActionPrimitive,
  scope: DispatchScope,
  deps: ProtocolDeps,
  input: {
    nodeId: string;
    capability: string;
    toolId: string;
    toolMatchTarget: string;
    policyEnabled: boolean;
    policyEvalPromise:
      | Promise<{ decision: string; policy_snapshot?: { policy_snapshot_id?: string } }>
      | undefined;
    isNodeAuthorizedForDispatch: (nodeId: string) => Promise<boolean>;
  },
): Promise<string> {
  const localTarget = [...deps.connectionManager.allClients()].find(
    (client) =>
      client.auth_claims?.tenant_id === scope.tenantId &&
      client.role === "node" &&
      client.device_id === input.nodeId,
  );
  if (localTarget) {
    if (
      localTarget.protocol_rev < 2 ||
      !hasCapability(localTarget.capabilities, input.capability)
    ) {
      throw new NodeNotCapableError(input.nodeId, input.capability);
    }
    if (!hasCapability(localTarget.readyCapabilities, input.capability)) {
      throw new NodeNotReadyError(input.nodeId, input.capability);
    }
    if (!(await input.isNodeAuthorizedForDispatch(input.nodeId))) {
      throw new NodeNotPairedError(input.capability);
    }

    const policyState = await resolvePolicyDispatchState(
      deps,
      scope,
      input.toolId,
      input.toolMatchTarget,
      input.policyEnabled,
      input.policyEvalPromise,
    );
    if (!policyState.nodeDispatchAllowed) {
      throw new NodeDispatchDeniedError(input.capability, policyState.policySnapshotId);
    }
    return await dispatchToLocalNode(deps, scope, action, localTarget, policyState.trace);
  }

  if (deps.cluster) {
    const nowMs = Date.now();
    const remoteRows = (
      await deps.cluster.connectionDirectory.listNonExpired(scope.tenantId, nowMs)
    )
      .filter(
        (row) =>
          row.role === "node" &&
          row.device_id === input.nodeId &&
          row.protocol_rev >= 2 &&
          row.expires_at_ms > nowMs,
      )
      .toSorted((a, b) => b.last_seen_at_ms - a.last_seen_at_ms);
    if (remoteRows.length > 0) {
      const capableRows = remoteRows.filter((row) =>
        hasCapability(row.capabilities, input.capability),
      );
      if (capableRows.length === 0) {
        throw new NodeNotCapableError(input.nodeId, input.capability);
      }

      const readyRows = capableRows.filter((row) =>
        hasCapability(row.ready_capabilities, input.capability),
      );
      if (readyRows.length === 0) {
        throw new NodeNotReadyError(input.nodeId, input.capability);
      }
      if (!(await input.isNodeAuthorizedForDispatch(input.nodeId))) {
        throw new NodeNotPairedError(input.capability);
      }

      const policyState = await resolvePolicyDispatchState(
        deps,
        scope,
        input.toolId,
        input.toolMatchTarget,
        input.policyEnabled,
        input.policyEvalPromise,
      );
      if (!policyState.nodeDispatchAllowed) {
        throw new NodeDispatchDeniedError(input.capability, policyState.policySnapshotId);
      }

      const target = readyRows.find((row) => row.edge_id !== deps.cluster!.edgeId) ?? readyRows[0]!;
      if (target.edge_id === deps.cluster.edgeId) {
        throw new NodeNotConnectedError(input.nodeId);
      }
      return await dispatchToClusterNode(deps, scope, action, target, policyState.trace);
    }
  }

  const pairing = deps.nodePairingDal
    ? await deps.nodePairingDal.getByNodeId(input.nodeId, scope.tenantId)
    : undefined;
  if (pairing) {
    throw new NodeNotConnectedError(input.nodeId);
  }
  throw new UnknownNodeError(input.nodeId);
}

// ---------------------------------------------------------------------------
// Gateway -> Node dispatch helpers
// ---------------------------------------------------------------------------

/**
 * Find a capable node and send a `task.execute` message.
 *
 * @throws {NoCapableNodeError} when no connected node has the required capability.
 * @throws {NodeNotPairedError} when nodes exist but none are paired/authorized.
 * @throws {NodeDispatchDeniedError} when policy denies node dispatch.
 * @returns the task_id assigned to the dispatched task.
 */
export function dispatchTask(
  action: ActionPrimitive,
  scope: DispatchScope,
  deps: ProtocolDeps,
  targetNodeId?: string,
): Promise<string> {
  const descriptorId = requiredCapabilityDescriptorForAction(action);
  if (descriptorId === undefined) {
    throw new NoCapableClientError(action.type);
  }

  const toolMatchTarget = `capability:${descriptorId};${canonicalizeNodeDispatchMatchTarget(
    action.type,
    action.args,
  )}`;
  const toolId = toolIdForCapabilityDescriptor(descriptorId);
  const policyEnabled = deps.policyService !== undefined;
  const policyEvalPromise = policyEnabled
    ? deps.policyService!.evaluateToolCall({
        tenantId: scope.tenantId,
        agentId: "default",
        toolId,
        toolMatchTarget,
        toolEffect: "state_changing",
      })
    : undefined;

  const isNodeAuthorizedForDispatch = async (nodeId: string): Promise<boolean> => {
    if (!deps.nodePairingDal) return false;

    const pairing = await deps.nodePairingDal.getByNodeId(nodeId, scope.tenantId);
    if (pairing?.status !== "approved") return false;
    const allowlist = pairing.capability_allowlist ?? [];
    return allowlist.some(
      (entry) =>
        entry.id === descriptorId && entry.version === CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
    );
  };

  if (typeof targetNodeId === "string" && targetNodeId.trim().length > 0) {
    return resolveTargetedDispatch(action, scope, deps, {
      nodeId: targetNodeId.trim(),
      capability: descriptorId,
      toolId,
      toolMatchTarget,
      policyEnabled,
      policyEvalPromise,
      isNodeAuthorizedForDispatch,
    });
  }

  const localCandidates: ConnectedClient[] = [];
  for (const client of deps.connectionManager.allClients()) {
    if (client.auth_claims?.tenant_id !== scope.tenantId) continue;
    if (client.protocol_rev >= 2 && hasCapability(client.capabilities, descriptorId)) {
      localCandidates.push(client);
    }
  }

  if (localCandidates.length === 0) {
    const cluster = deps.cluster;
    if (!cluster) {
      throw new NoCapableNodeError(descriptorId);
    }

    const nowMs = Date.now();
    return (async (): Promise<string> => {
      const policyState = await resolvePolicyDispatchState(
        deps,
        scope,
        toolId,
        toolMatchTarget,
        policyEnabled,
        policyEvalPromise,
      );

      const candidates = await cluster.connectionDirectory.listConnectionsForCapability(
        scope.tenantId,
        descriptorId,
        nowMs,
      );
      const nodeCandidates = candidates.filter(
        (candidate) =>
          candidate.protocol_rev >= 2 &&
          candidate.role === "node" &&
          typeof candidate.device_id === "string" &&
          candidate.device_id.trim().length > 0 &&
          hasCapability(candidate.ready_capabilities, descriptorId),
      );

      const authorizedNodes = deps.nodePairingDal
        ? (
            await Promise.all(
              nodeCandidates.map(async (candidate) => {
                return (await isNodeAuthorizedForDispatch(candidate.device_id!)) ? candidate : null;
              }),
            )
          ).filter(
            (candidate): candidate is NonNullable<(typeof candidates)[number]> =>
              candidate !== null,
          )
        : [];
      const eligibleNodes = policyState.nodeDispatchAllowed ? authorizedNodes : [];

      const target =
        eligibleNodes.find((candidate) => candidate.edge_id !== cluster.edgeId) ?? eligibleNodes[0];
      if (!target || target.edge_id === cluster.edgeId) {
        if (!policyState.nodeDispatchAllowed && authorizedNodes.length > 0) {
          throw new NodeDispatchDeniedError(descriptorId, policyState.policySnapshotId);
        }
        throw nodeCandidates.length > 0
          ? new NodeNotPairedError(descriptorId)
          : new NoCapableNodeError(descriptorId);
      }

      return await dispatchToClusterNode(deps, scope, action, target, policyState.trace);
    })();
  }

  return (async (): Promise<string> => {
    const policyState = await resolvePolicyDispatchState(
      deps,
      scope,
      toolId,
      toolMatchTarget,
      policyEnabled,
      policyEvalPromise,
    );

    const eligibleNodes: ConnectedClient[] = [];
    let hasReadyNodeCandidate = false;
    let hasAuthorizedNodeCandidate = false;

    for (const candidate of localCandidates) {
      if (candidate.role !== "node") continue;
      const nodeId = candidate.device_id;
      if (!nodeId) continue;
      if (!hasCapability(candidate.readyCapabilities, descriptorId)) continue;
      hasReadyNodeCandidate = true;
      const authorized = await isNodeAuthorizedForDispatch(nodeId);
      if (authorized) {
        hasAuthorizedNodeCandidate = true;
      }
      if (!policyState.nodeDispatchAllowed) {
        if (hasAuthorizedNodeCandidate) break;
        continue;
      }
      if (!authorized) continue;
      eligibleNodes.push(candidate);
    }

    const selected = eligibleNodes[0];
    if (!selected) {
      const cluster = deps.cluster;
      if (!cluster) {
        if (!policyState.nodeDispatchAllowed && hasAuthorizedNodeCandidate) {
          throw new NodeDispatchDeniedError(descriptorId, policyState.policySnapshotId);
        }
        throw hasReadyNodeCandidate
          ? new NodeNotPairedError(descriptorId)
          : new NoCapableNodeError(descriptorId);
      }

      if (!policyState.nodeDispatchAllowed && hasAuthorizedNodeCandidate) {
        throw new NodeDispatchDeniedError(descriptorId, policyState.policySnapshotId);
      }

      const nowMs = Date.now();
      const candidates = await cluster.connectionDirectory.listConnectionsForCapability(
        scope.tenantId,
        descriptorId,
        nowMs,
      );
      const nodeCandidates = candidates.filter(
        (candidate) =>
          candidate.protocol_rev >= 2 &&
          candidate.role === "node" &&
          typeof candidate.device_id === "string" &&
          candidate.device_id.trim().length > 0 &&
          hasCapability(candidate.ready_capabilities, descriptorId),
      );

      const authorizedNodes = deps.nodePairingDal
        ? (
            await Promise.all(
              nodeCandidates.map(async (candidate) => {
                return (await isNodeAuthorizedForDispatch(candidate.device_id!)) ? candidate : null;
              }),
            )
          ).filter(
            (candidate): candidate is NonNullable<(typeof candidates)[number]> =>
              candidate !== null,
          )
        : [];
      const eligibleNodes2 = policyState.nodeDispatchAllowed ? authorizedNodes : [];

      const target =
        eligibleNodes2.find((candidate) => candidate.edge_id !== cluster.edgeId) ??
        eligibleNodes2[0];
      if (!target || target.edge_id === cluster.edgeId) {
        if (
          !policyState.nodeDispatchAllowed &&
          (hasAuthorizedNodeCandidate || authorizedNodes.length > 0)
        ) {
          throw new NodeDispatchDeniedError(descriptorId, policyState.policySnapshotId);
        }
        throw nodeCandidates.length > 0 || hasReadyNodeCandidate
          ? new NodeNotPairedError(descriptorId)
          : new NoCapableNodeError(descriptorId);
      }

      return await dispatchToClusterNode(deps, scope, action, target, policyState.trace);
    }

    return await dispatchToLocalNode(deps, scope, action, selected, policyState.trace);
  })();
}
