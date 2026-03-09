import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
  requiredCapability,
} from "@tyrum/schemas";
import type { ActionPrimitive, CapabilityKind, WsRequestEnvelope } from "@tyrum/schemas";
import { canonicalizeNodeDispatchMatchTarget } from "../../modules/policy/match-target.js";
import type { ConnectionDirectoryRow } from "../../modules/backplane/connection-directory.js";
import type { ConnectedClient } from "../connection-manager.js";
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

async function resolvePolicyDispatchState(
  deps: ProtocolDeps,
  _scope: DispatchScope,
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
          tool_id: "tool.node.dispatch",
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
    nodeId: target.device_id,
    connectionId: target.connection_id,
    edgeId: target.edge_id,
  });

  const requestId = `task-${crypto.randomUUID()}`;
  const message: WsRequestEnvelope = {
    request_id: requestId,
    type: "task.execute",
    payload: {
      run_id: scope.runId,
      step_id: scope.stepId,
      attempt_id: scope.attemptId,
      action,
    },
    trace,
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
      run_id: scope.runId,
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
    capability: CapabilityKind;
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
    if (localTarget.protocol_rev < 2 || !localTarget.capabilities.includes(input.capability)) {
      throw new NodeNotCapableError(input.nodeId, input.capability);
    }
    if (!localTarget.readyCapabilities.has(input.capability)) {
      throw new NodeNotReadyError(input.nodeId, input.capability);
    }
    if (!(await input.isNodeAuthorizedForDispatch(input.nodeId))) {
      throw new NodeNotPairedError(input.capability);
    }

    const policyState = await resolvePolicyDispatchState(
      deps,
      scope,
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
      const capableRows = remoteRows.filter((row) => row.capabilities.includes(input.capability));
      if (capableRows.length === 0) {
        throw new NodeNotCapableError(input.nodeId, input.capability);
      }

      const readyRows = capableRows.filter((row) =>
        row.ready_capabilities.includes(input.capability),
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
  const capability = requiredCapability(action.type);
  if (capability === undefined) {
    throw new NoCapableClientError(action.type as CapabilityKind);
  }

  const descriptorId = descriptorIdForClientCapability(capability);
  const toolMatchTarget = canonicalizeNodeDispatchMatchTarget(action.type, action.args);
  const policyEnabled = deps.policyService?.isEnabled() ?? false;
  const policyEvalPromise = policyEnabled
    ? deps.policyService!.evaluateToolCall({
        tenantId: scope.tenantId,
        agentId: "default",
        toolId: "tool.node.dispatch",
        toolMatchTarget,
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
      capability,
      toolMatchTarget,
      policyEnabled,
      policyEvalPromise,
      isNodeAuthorizedForDispatch,
    });
  }

  const localCandidates: ConnectedClient[] = [];
  for (const client of deps.connectionManager.allClients()) {
    if (client.auth_claims?.tenant_id !== scope.tenantId) continue;
    if (client.protocol_rev >= 2 && client.capabilities.includes(capability)) {
      localCandidates.push(client);
    }
  }

  if (localCandidates.length === 0) {
    const cluster = deps.cluster;
    if (!cluster) {
      throw new NoCapableNodeError(capability);
    }

    const nowMs = Date.now();
    return (async (): Promise<string> => {
      const policyState = await resolvePolicyDispatchState(
        deps,
        scope,
        toolMatchTarget,
        policyEnabled,
        policyEvalPromise,
      );

      const candidates = await cluster.connectionDirectory.listConnectionsForCapability(
        scope.tenantId,
        capability,
        nowMs,
      );
      const nodeCandidates = candidates.filter(
        (candidate) =>
          candidate.protocol_rev >= 2 &&
          candidate.role === "node" &&
          typeof candidate.device_id === "string" &&
          candidate.device_id.trim().length > 0 &&
          candidate.ready_capabilities.includes(capability),
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
          throw new NodeDispatchDeniedError(capability, policyState.policySnapshotId);
        }
        throw nodeCandidates.length > 0
          ? new NodeNotPairedError(capability)
          : new NoCapableNodeError(capability);
      }

      return await dispatchToClusterNode(deps, scope, action, target, policyState.trace);
    })();
  }

  return (async (): Promise<string> => {
    const policyState = await resolvePolicyDispatchState(
      deps,
      scope,
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
      if (!candidate.readyCapabilities.has(capability)) continue;
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
          throw new NodeDispatchDeniedError(capability, policyState.policySnapshotId);
        }
        throw hasReadyNodeCandidate
          ? new NodeNotPairedError(capability)
          : new NoCapableNodeError(capability);
      }

      if (!policyState.nodeDispatchAllowed && hasAuthorizedNodeCandidate) {
        throw new NodeDispatchDeniedError(capability, policyState.policySnapshotId);
      }

      const nowMs = Date.now();
      const candidates = await cluster.connectionDirectory.listConnectionsForCapability(
        scope.tenantId,
        capability,
        nowMs,
      );
      const nodeCandidates = candidates.filter(
        (candidate) =>
          candidate.protocol_rev >= 2 &&
          candidate.role === "node" &&
          typeof candidate.device_id === "string" &&
          candidate.device_id.trim().length > 0 &&
          candidate.ready_capabilities.includes(capability),
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
          throw new NodeDispatchDeniedError(capability, policyState.policySnapshotId);
        }
        throw nodeCandidates.length > 0 || hasReadyNodeCandidate
          ? new NodeNotPairedError(capability)
          : new NoCapableNodeError(capability);
      }

      return await dispatchToClusterNode(deps, scope, action, target, policyState.trace);
    }

    return await dispatchToLocalNode(deps, scope, action, selected, policyState.trace);
  })();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function upsertAttemptExecutorMetadata(
  deps: ProtocolDeps,
  attemptId: string,
  executor: { nodeId: string; connectionId: string; edgeId?: string },
): Promise<void> {
  const db = deps.db;
  if (!db) return;
  if (!attemptId || attemptId.trim().length === 0) return;
  if (!executor.nodeId || executor.nodeId.trim().length === 0) return;
  if (!executor.connectionId || executor.connectionId.trim().length === 0) return;

  try {
    const row = await db.get<{ metadata_json: string | null }>(
      "SELECT metadata_json FROM execution_attempts WHERE attempt_id = ?",
      [attemptId],
    );
    if (!row) return;

    let meta: Record<string, unknown> = {};
    if (typeof row.metadata_json === "string" && row.metadata_json.trim().length > 0) {
      try {
        const parsed = JSON.parse(row.metadata_json) as unknown;
        if (isObject(parsed)) meta = parsed;
      } catch (_err) {
        void _err;
        // Intentional: malformed metadata_json should not break WS dispatch metadata persistence.
      }
    }

    const executorMeta: Record<string, unknown> = {
      kind: "node",
      node_id: executor.nodeId,
      connection_id: executor.connectionId,
    };
    if (typeof executor.edgeId === "string" && executor.edgeId.trim().length > 0) {
      executorMeta["edge_id"] = executor.edgeId;
    }

    meta["executor"] = executorMeta;
    await db.run("UPDATE execution_attempts SET metadata_json = ? WHERE attempt_id = ?", [
      JSON.stringify(meta),
      attemptId,
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.warn("execution.attempt.executor_metadata_persist_failed", {
      attempt_id: attemptId,
      node_id: executor.nodeId,
      connection_id: executor.connectionId,
      edge_id: executor.edgeId,
      error: message,
    });
  }
}
