import type { TaskResult } from "./task-result-registry.js";

export const CLUSTER_TASK_RESULT_RELAY_TOPIC = "ws.cluster.task_result";
const CLUSTER_TASK_ORIGIN_EDGE_TRACE_KEY = "source_edge_id";
const CLUSTER_TASK_RESULT_ROUTE_LIMIT = 10_000;

export interface ClusterTaskResultRoute {
  tenantId: string;
  originEdgeId: string;
}

export interface ClusterTaskResultRelayOutboxDal {
  enqueue(
    tenantId: string,
    topic: string,
    payload: unknown,
    opts?: { targetEdgeId?: string | null },
  ): Promise<unknown>;
}

export interface ClusterTaskResultRelayLogger {
  warn?(message: string, fields: Record<string, unknown>): void;
}

export class ClusterTaskResultRouteRegistry {
  private readonly routes = new Map<string, ClusterTaskResultRoute>();

  associate(taskId: string, route: ClusterTaskResultRoute): void {
    const normalizedTaskId = taskId.trim();
    const tenantId = route.tenantId.trim();
    const originEdgeId = route.originEdgeId.trim();
    if (normalizedTaskId.length === 0) return;
    if (tenantId.length === 0) return;
    if (originEdgeId.length === 0) return;

    this.routes.delete(normalizedTaskId);
    this.routes.set(normalizedTaskId, { tenantId, originEdgeId });

    while (this.routes.size > CLUSTER_TASK_RESULT_ROUTE_LIMIT) {
      const oldest = this.routes.keys().next().value as string | undefined;
      if (!oldest) break;
      this.routes.delete(oldest);
    }
  }

  consume(taskId: string): ClusterTaskResultRoute | undefined {
    const normalizedTaskId = taskId.trim();
    if (normalizedTaskId.length === 0) return undefined;

    const route = this.routes.get(normalizedTaskId);
    if (!route) return undefined;
    this.routes.delete(normalizedTaskId);
    return route;
  }
}

const defaultClusterTaskResultRoutes = new ClusterTaskResultRouteRegistry();

export function associateClusterTaskResultRoute(
  taskId: string,
  route: ClusterTaskResultRoute,
): void {
  defaultClusterTaskResultRoutes.associate(taskId, route);
}

export function consumeClusterTaskResultRoute(taskId: string): ClusterTaskResultRoute | undefined {
  return defaultClusterTaskResultRoutes.consume(taskId);
}

export function withClusterTaskOrigin(
  trace: unknown,
  sourceEdgeId: string,
): Record<string, unknown> {
  const normalizedSourceEdgeId = sourceEdgeId.trim();
  if (normalizedSourceEdgeId.length === 0) {
    return isPlainObject(trace) ? { ...trace } : {};
  }

  if (!isPlainObject(trace)) {
    return { [CLUSTER_TASK_ORIGIN_EDGE_TRACE_KEY]: normalizedSourceEdgeId };
  }

  return {
    ...trace,
    [CLUSTER_TASK_ORIGIN_EDGE_TRACE_KEY]: normalizedSourceEdgeId,
  };
}

export function readClusterTaskOriginEdgeId(trace: unknown): string | undefined {
  if (!isPlainObject(trace)) return undefined;
  const originEdgeId = trace[CLUSTER_TASK_ORIGIN_EDGE_TRACE_KEY];
  return typeof originEdgeId === "string" && originEdgeId.trim().length > 0
    ? originEdgeId.trim()
    : undefined;
}

export interface ClusterTaskResultRelayPayload {
  task_id: string;
  task_result: TaskResult;
}

export function parseClusterTaskResultRelayPayload(
  payload: unknown,
): ClusterTaskResultRelayPayload | undefined {
  if (!isPlainObject(payload)) return undefined;

  const taskId = payload["task_id"];
  const taskResult = payload["task_result"];
  if (typeof taskId !== "string" || taskId.trim().length === 0) return undefined;
  if (!isTaskResult(taskResult)) return undefined;

  return {
    task_id: taskId.trim(),
    task_result: taskResult,
  };
}

export function createClusterTaskResultRelayDispatcher(input: {
  outboxDal: ClusterTaskResultRelayOutboxDal;
  clusterTaskResultRoutes: ClusterTaskResultRouteRegistry;
  logger?: ClusterTaskResultRelayLogger;
}): (taskId: string, taskResult: TaskResult) => Promise<boolean> {
  return async (taskId, taskResult) => {
    const route = input.clusterTaskResultRoutes.consume(taskId);
    if (!route) {
      return false;
    }

    try {
      await input.outboxDal.enqueue(
        route.tenantId,
        CLUSTER_TASK_RESULT_RELAY_TOPIC,
        {
          task_id: taskId,
          task_result: taskResult,
        },
        { targetEdgeId: route.originEdgeId },
      );
      return true;
    } catch (error) {
      input.clusterTaskResultRoutes.associate(taskId, route);
      input.logger?.warn?.("ws.cluster_task_result_relay_failed", {
        task_id: taskId,
        tenant_id: route.tenantId,
        origin_edge_id: route.originEdgeId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTaskResult(value: unknown): value is TaskResult {
  if (!isPlainObject(value)) return false;
  if (typeof value.ok !== "boolean") return false;
  if (value.ok) {
    return true;
  }
  return typeof value.error === "string";
}
