import {
  NodeActionDispatchResponse,
  type ActionPrimitive,
  type DispatchErrorCode,
  type NodeActionDispatchError,
  type NodeActionDispatchRequest,
  type NodeActionDispatchResponse as NodeActionDispatchResponseT,
} from "@tyrum/contracts";
import { ZodError } from "zod";
import {
  NoCapableNodeError,
  NodeDispatchDeniedError,
  NodeNotCapableError,
  NodeNotConnectedError,
  NodeNotPairedError,
  NodeNotReadyError,
  UnknownNodeError,
} from "../../ws/protocol/errors.js";
import type { ArtifactStore } from "../artifact/store.js";
import {
  resolveBrowserEvidenceSensitivity,
  shapeBrowserEvidenceForArtifacts,
} from "../browser/shape-browser-evidence.js";
import {
  resolveDesktopEvidenceSensitivity,
  shapeDesktopEvidenceForArtifacts,
} from "../desktop/shape-desktop-evidence.js";
import {
  resolveMobileEvidenceSensitivity,
  shapeMobileEvidenceForArtifacts,
} from "../mobile/shape-mobile-evidence.js";
import {
  DEFAULT_NODE_DISPATCH_TIMEOUT_MS,
  MAX_NODE_DISPATCH_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  TRUNCATION_MARKER,
} from "./tool-executor-shared.js";
import type { WorkspaceLeaseConfig } from "./tool-executor-shared.js";

export type DispatchArtifactContext = {
  artifactStore?: ArtifactStore;
  workspaceLease?: WorkspaceLeaseConfig;
};

export function normalizeJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function dispatchError(
  code: DispatchErrorCode,
  message: string,
  retryable = false,
  details?: NodeActionDispatchError["details"],
): NodeActionDispatchError {
  return details ? { code, message, retryable, details } : { code, message, retryable };
}

type ValidationIssue = NonNullable<
  NonNullable<NodeActionDispatchError["details"]>["issues"]
>[number];

function joinIssuePath(path: readonly PropertyKey[]): string {
  const joined = path
    .map((segment) => String(segment).trim())
    .filter((segment) => segment.length > 0)
    .join(".");
  return joined.length > 0 ? joined : "input";
}

function flattenZodIssues(
  error: ZodError,
  parentPath: readonly PropertyKey[] = [],
  issues: ValidationIssue[] = [],
): ValidationIssue[] {
  for (const issue of error.issues) {
    if (
      issue.code === "invalid_union" &&
      "errors" in issue &&
      Array.isArray(issue.errors) &&
      issue.errors.length > 0
    ) {
      const preferredNested =
        issue.errors.find((entry) =>
          entry.some(
            (nested) =>
              nested.code === "invalid_type" &&
              nested.path.length === 0 &&
              String(nested.message).toLowerCase().includes("received undefined"),
          ),
        ) ?? issue.errors[0];
      if (preferredNested) {
        const nestedIssues = preferredNested.map((nested) =>
          Object.assign({}, nested, {
            path: [...parentPath, ...issue.path, ...nested.path],
          }),
        );
        const nestedError = new ZodError(nestedIssues);
        flattenZodIssues(nestedError, [], issues);
        continue;
      }
    }

    issues.push({
      path: joinIssuePath([...parentPath, ...issue.path]),
      message: issue.message,
    });
  }
  return issues;
}

function summarizeValidationIssues(issues: readonly ValidationIssue[]): string {
  const first = issues[0];
  if (!first) {
    return "invalid input";
  }
  if (first.path === "display" && first.message.toLowerCase().includes("undefined")) {
    return "invalid input: display is required; use 'primary', 'all', or { id }";
  }
  if (first.message.toLowerCase().includes("received undefined")) {
    return `invalid input: missing required field '${first.path}'`;
  }
  return `invalid input: ${first.path} ${first.message}`;
}

export function normalizeValidationFailure(error: unknown): NodeActionDispatchError {
  if (!(error instanceof ZodError)) {
    const message = error instanceof Error ? error.message : String(error);
    return dispatchError("invalid_input", message);
  }

  const issues = flattenZodIssues(error);
  return dispatchError(
    "invalid_input",
    summarizeValidationIssues(issues),
    false,
    issues.length > 0 ? { issues } : undefined,
  );
}

export function preflightFailure(
  request: NodeActionDispatchRequest,
  error: NodeActionDispatchError,
): NodeActionDispatchResponseT {
  return NodeActionDispatchResponse.parse({
    status: "ok",
    task_id: "not-dispatched",
    node_id: request.node_id,
    capability: request.capability,
    action_name: request.action_name,
    ok: false,
    payload_source: "none",
    payload: null,
    error,
  });
}

export function normalizeExecutionFailure(error: unknown): NodeActionDispatchError {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("timeout")) {
    return dispatchError("dispatch_timeout", message, true);
  }
  if (error instanceof NodeNotPairedError) {
    return dispatchError("capability_not_paired", message, false);
  }
  if (error instanceof NodeNotConnectedError || error instanceof NodeNotReadyError) {
    return dispatchError("runtime_unavailable", message, true);
  }
  if (error instanceof UnknownNodeError || error instanceof NoCapableNodeError) {
    return dispatchError("runtime_unavailable", message, false);
  }
  if (error instanceof NodeNotCapableError) {
    return dispatchError("action_not_supported", message, false);
  }
  if (error instanceof NodeDispatchDeniedError) {
    return dispatchError("execution_failed", message, false);
  }
  if (normalized.includes("task connection disconnected")) {
    return dispatchError("runtime_unavailable", message, true);
  }

  return dispatchError("execution_failed", message, false);
}

export function normalizeProviderError(error: string | undefined): NodeActionDispatchError | null {
  if (!error || error.trim().length === 0) return null;
  const normalized = error.toLowerCase();

  if (normalized.includes("denied")) {
    if (normalized.includes("permission")) {
      return dispatchError("permission_denied", error, false);
    }
    return dispatchError("consent_denied", error, false);
  }
  if (normalized.includes("permission")) {
    return dispatchError("permission_denied", error, false);
  }
  if (
    normalized.includes("unavailable") ||
    normalized.includes("secure context") ||
    normalized.includes("missing") ||
    normalized.includes("not supported")
  ) {
    return dispatchError("runtime_unavailable", error, false);
  }

  return dispatchError("execution_failed", error, false);
}

export function resolveTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return DEFAULT_NODE_DISPATCH_TIMEOUT_MS;
  return Math.max(1, Math.min(MAX_NODE_DISPATCH_TIMEOUT_MS, Math.floor(timeoutMs)));
}

export function serializeToolDispatchResponse(response: NodeActionDispatchResponseT): string {
  let serialized = JSON.stringify(response);
  if (serialized.length <= MAX_RESPONSE_BYTES) {
    return serialized;
  }

  serialized = JSON.stringify({
    ...response,
    payload_source: "none",
    payload: "[omitted: payload too large]",
    truncated: true,
    error:
      response.error && response.error.message.length > 4_096
        ? {
            ...response.error,
            message: `${response.error.message.slice(0, 4_096)}${TRUNCATION_MARKER}`,
          }
        : response.error,
  });
  return serialized;
}

export async function shapeNodeDispatchEvidence(
  context: DispatchArtifactContext,
  actionKind: ActionPrimitive["type"],
  evidence: unknown,
  result: unknown,
  scope: { runId: string; stepId: string },
  policySnapshotId?: string,
): Promise<unknown> {
  if (
    actionKind !== "Desktop" &&
    actionKind !== "Browser" &&
    actionKind !== "Web" &&
    actionKind !== "IOS" &&
    actionKind !== "Android"
  ) {
    return evidence;
  }
  if (!context.artifactStore) return evidence;
  const lease = context.workspaceLease;
  const db = lease?.db;
  if (!db) return evidence;

  const fallbackScope = lease
    ? {
        tenantId: lease.tenantId,
        workspaceId: lease.workspaceId,
        agentId: lease.agentId,
        policySnapshotId: policySnapshotId?.trim() || null,
      }
    : undefined;

  if (actionKind === "Desktop") {
    const sensitivity = await resolveDesktopEvidenceSensitivity(db, scope);
    const shaped = await shapeDesktopEvidenceForArtifacts({
      db,
      artifactStore: context.artifactStore,
      runId: scope.runId,
      stepId: scope.stepId,
      workspaceId: lease?.workspaceId,
      fallbackScope,
      evidence,
      result,
      sensitivity,
    });
    return shaped.evidence;
  }

  if (actionKind === "Browser") {
    const sensitivity = resolveBrowserEvidenceSensitivity();
    const shaped = await shapeBrowserEvidenceForArtifacts({
      db,
      artifactStore: context.artifactStore,
      runId: scope.runId,
      stepId: scope.stepId,
      workspaceId: lease?.workspaceId,
      fallbackScope,
      evidence,
      result,
      sensitivity,
    });
    return shaped.evidence;
  }

  const sensitivity = resolveMobileEvidenceSensitivity();
  const shaped = await shapeMobileEvidenceForArtifacts({
    db,
    artifactStore: context.artifactStore,
    runId: scope.runId,
    stepId: scope.stepId,
    workspaceId: lease?.workspaceId,
    fallbackScope,
    evidence,
    result,
    sensitivity,
    platformLabel: actionKind === "IOS" ? "ios" : "android",
  });
  return shaped.evidence;
}

export function selectPayload(
  resultChannel: "result" | "evidence" | "result_or_evidence",
  result: unknown,
  evidence: unknown,
): { payload_source: "result" | "evidence" | "none"; payload: unknown | null } {
  if (resultChannel === "result") {
    return result !== undefined
      ? { payload_source: "result", payload: result }
      : { payload_source: "none", payload: null };
  }
  if (resultChannel === "evidence") {
    return evidence !== undefined
      ? { payload_source: "evidence", payload: evidence }
      : { payload_source: "none", payload: null };
  }
  if (evidence !== undefined && evidence !== null) {
    return { payload_source: "evidence", payload: evidence };
  }
  if (result !== undefined && result !== null) {
    return { payload_source: "result", payload: result };
  }
  return { payload_source: "none", payload: null };
}
