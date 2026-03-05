import {
  CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
  descriptorIdForClientCapability,
  requiredCapability,
} from "@tyrum/schemas";
import type { ActionPrimitive, ClientCapability, WsRequestEnvelope } from "@tyrum/schemas";
import { canonicalizeNodeDispatchMatchTarget } from "../../modules/policy/match-target.js";
import type { ConnectedClient } from "../connection-manager.js";
import { NoCapableClientError, NoCapableNodeError, NodeNotPairedError } from "./errors.js";
import type { ProtocolDeps } from "./types.js";

// ---------------------------------------------------------------------------
// Gateway -> Node dispatch helpers
// ---------------------------------------------------------------------------

/**
 * Find a capable node and send a `task.execute` message.
 *
 * @throws {NoCapableNodeError} when no connected node has the required capability.
 * @throws {NodeNotPairedError} when nodes exist but none are paired/authorized.
 * @returns the task_id assigned to the dispatched task.
 */
export function dispatchTask(
  action: ActionPrimitive,
  scope: { runId: string; stepId: string; attemptId: string },
  deps: ProtocolDeps,
): Promise<string> {
  const capability = requiredCapability(action.type);
  if (capability === undefined) {
    throw new NoCapableClientError(action.type as ClientCapability);
  }

  const descriptorId = descriptorIdForClientCapability(capability);
  const toolMatchTarget = canonicalizeNodeDispatchMatchTarget(action.type, action.args);
  const policyEnabled = deps.policyService?.isEnabled() ?? false;
  const policyEvalPromise = policyEnabled
    ? deps.policyService!.evaluateToolCall({
        agentId: "default",
        toolId: "tool.node.dispatch",
        toolMatchTarget,
      })
    : undefined;

  const isNodeAuthorizedForDispatch = async (nodeId: string): Promise<boolean> => {
    if (!deps.nodePairingDal) return false;

    const pairing = await deps.nodePairingDal.getByNodeId(nodeId);
    if (pairing?.status !== "approved") return false;
    const allowlist = pairing.capability_allowlist ?? [];
    return allowlist.some(
      (entry) =>
        entry.id === descriptorId && entry.version === CAPABILITY_DESCRIPTOR_DEFAULT_VERSION,
    );
  };

  const localCandidates: ConnectedClient[] = [];
  for (const c of deps.connectionManager.allClients()) {
    if (c.protocol_rev >= 2 && c.capabilities.includes(capability)) {
      localCandidates.push(c);
    }
  }

  if (localCandidates.length === 0) {
    const cluster = deps.cluster;
    if (!cluster) {
      throw new NoCapableNodeError(capability);
    }

    const nowMs = Date.now();
    return (async (): Promise<string> => {
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
      const nodeDispatchAllowed = !shouldEnforcePolicy || policyDecision !== "deny";
      const trace =
        policySnapshotId || policyDecision
          ? { policy_snapshot_id: policySnapshotId, policy_decision: policyDecision }
          : undefined;

      const candidates = await cluster.connectionDirectory.listConnectionsForCapability(
        capability,
        nowMs,
      );

      const nodeCandidates = candidates.filter(
        (c) =>
          c.protocol_rev >= 2 &&
          c.role === "node" &&
          typeof c.device_id === "string" &&
          c.device_id.trim().length > 0 &&
          c.ready_capabilities.includes(capability),
      );

      const eligibleNodes =
        deps.nodePairingDal && nodeDispatchAllowed
          ? (
              await Promise.all(
                nodeCandidates.map(async (c) => {
                  return (await isNodeAuthorizedForDispatch(c.device_id!)) ? c : null;
                }),
              )
            ).filter((c): c is NonNullable<(typeof candidates)[number]> => c !== null)
          : [];

      const target = eligibleNodes.find((c) => c.edge_id !== cluster.edgeId) ?? eligibleNodes[0];
      if (!target || target.edge_id === cluster.edgeId) {
        throw nodeCandidates.length > 0
          ? new NodeNotPairedError(capability)
          : new NoCapableNodeError(capability);
      }

      if (
        target.role === "node" &&
        typeof target.device_id === "string" &&
        target.device_id.trim().length > 0
      ) {
        await upsertAttemptExecutorMetadata(deps, scope.attemptId, {
          nodeId: target.device_id,
          connectionId: target.connection_id,
          edgeId: target.edge_id,
        });
      }

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
        "ws.direct",
        { connection_id: target.connection_id, message },
        { targetEdgeId: target.edge_id },
      );
      return requestId;
    })();
  }

  return (async (): Promise<string> => {
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
    const nodeDispatchAllowed = !shouldEnforcePolicy || policyDecision !== "deny";
    const trace =
      policySnapshotId || policyDecision
        ? { policy_snapshot_id: policySnapshotId, policy_decision: policyDecision }
        : undefined;

    const eligibleNodes: ConnectedClient[] = [];
    let hasReadyNodeCandidate = false;

    for (const c of localCandidates) {
      if (c.role !== "node") continue;
      const nodeId = c.device_id;
      if (!nodeId) continue;
      if (!c.readyCapabilities.has(capability)) continue;
      hasReadyNodeCandidate = true;
      if (!nodeDispatchAllowed) continue;
      if (!(await isNodeAuthorizedForDispatch(nodeId))) continue;
      eligibleNodes.push(c);
    }

    const selected = eligibleNodes[0];
    if (!selected) {
      const cluster = deps.cluster;
      if (!cluster) {
        throw hasReadyNodeCandidate
          ? new NodeNotPairedError(capability)
          : new NoCapableNodeError(capability);
      }

      const nowMs = Date.now();
      const candidates = await cluster.connectionDirectory.listConnectionsForCapability(
        capability,
        nowMs,
      );

      const nodeCandidates = candidates.filter(
        (c) =>
          c.protocol_rev >= 2 &&
          c.role === "node" &&
          typeof c.device_id === "string" &&
          c.device_id.trim().length > 0 &&
          c.ready_capabilities.includes(capability),
      );

      const eligibleNodes2 =
        deps.nodePairingDal && nodeDispatchAllowed
          ? (
              await Promise.all(
                nodeCandidates.map(async (c) => {
                  return (await isNodeAuthorizedForDispatch(c.device_id!)) ? c : null;
                }),
              )
            ).filter((c): c is NonNullable<(typeof candidates)[number]> => c !== null)
          : [];

      const target = eligibleNodes2.find((c) => c.edge_id !== cluster.edgeId) ?? eligibleNodes2[0];
      if (!target || target.edge_id === cluster.edgeId) {
        throw nodeCandidates.length > 0 || hasReadyNodeCandidate
          ? new NodeNotPairedError(capability)
          : new NoCapableNodeError(capability);
      }

      if (
        target.role === "node" &&
        typeof target.device_id === "string" &&
        target.device_id.trim().length > 0
      ) {
        await upsertAttemptExecutorMetadata(deps, scope.attemptId, {
          nodeId: target.device_id,
          connectionId: target.connection_id,
          edgeId: target.edge_id,
        });
      }

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
        "ws.direct",
        { connection_id: target.connection_id, message },
        { targetEdgeId: target.edge_id },
      );
      return requestId;
    }

    if (selected.role === "node") {
      const nodeId = selected.device_id;
      if (nodeId) {
        await upsertAttemptExecutorMetadata(deps, scope.attemptId, {
          nodeId,
          connectionId: selected.id,
          edgeId: deps.cluster?.edgeId,
        });
      }
    }

    const requestId = `task-${crypto.randomUUID()}`;
    deps.taskResults?.associate(requestId, selected.id);
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
    selected.ws.send(JSON.stringify(message));
    if (selected.role === "node") {
      const dispatchedNodeId = selected.device_id ?? selected.id;
      deps.connectionManager.recordDispatchedAttemptExecutor(scope.attemptId, dispatchedNodeId);
    }
    return requestId;
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
