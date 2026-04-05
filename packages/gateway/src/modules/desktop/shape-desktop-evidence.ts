import type { ArtifactRef as ArtifactRefT } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import type { ArtifactStore } from "../artifact/store.js";
import {
  persistExecutionArtifactBytes,
  type ExecutionArtifactFallbackScope,
  type ExecutionArtifactSensitivity,
} from "../artifact/execution-artifacts.js";
import { parseEvidenceSensitivity } from "../artifact/evidence-sensitivity.js";

function resolveDesktopSandboxEvidenceSensitivity(): ExecutionArtifactSensitivity {
  return parseEvidenceSensitivity(undefined, "normal");
}

function resolveDesktopEvidenceSensitivityForMode(
  mode: string | undefined,
): ExecutionArtifactSensitivity {
  const normalizedMode = mode?.trim().toLowerCase();
  if (normalizedMode === "desktop-sandbox") {
    return resolveDesktopSandboxEvidenceSensitivity();
  }

  return parseEvidenceSensitivity(undefined, "sensitive");
}

async function resolveExecutorNodeIdFromDispatchRecord(
  db: SqlDb,
  scope: { tenantId: string; turnId: string; dispatchId?: string },
): Promise<string | undefined> {
  const readNodeId = async (sql: string, params: readonly string[]) => {
    const row = await db.get<{ selected_node_id: string | null }>(sql, [...params]);
    const nodeId = row?.selected_node_id;
    return typeof nodeId === "string" && nodeId.trim().length > 0 ? nodeId.trim() : undefined;
  };

  if (scope.dispatchId?.trim()) {
    const exactMatch = await readNodeId(
      `SELECT selected_node_id
       FROM dispatch_records
       WHERE tenant_id = ?
         AND dispatch_id = ?
         AND selected_node_id IS NOT NULL
       LIMIT 1`,
      [scope.tenantId, scope.dispatchId.trim()],
    );
    if (exactMatch) {
      return exactMatch;
    }
  }

  return await readNodeId(
    `SELECT selected_node_id
     FROM dispatch_records
     WHERE tenant_id = ?
       AND turn_id = ?
       AND selected_node_id IS NOT NULL
     ORDER BY COALESCE(completed_at, updated_at, created_at) DESC,
              created_at DESC,
              dispatch_id DESC
     LIMIT 1`,
    [scope.tenantId, scope.turnId],
  );
}

export async function resolveDesktopEvidenceSensitivity(
  db: SqlDb,
  scope: { tenantId: string; turnId: string; stepId: string; dispatchId?: string },
): Promise<ExecutionArtifactSensitivity> {
  let executorNodeId: string | undefined;

  try {
    const attemptRow = await db.get<{ metadata_json: string | null }>(
      `SELECT ea.metadata_json
       FROM execution_attempts ea
       JOIN execution_steps es ON es.step_id = ea.step_id
       WHERE ea.tenant_id = ?
         AND ea.step_id = ?
         AND es.tenant_id = ?
         AND es.turn_id = ?
       ORDER BY ea.attempt DESC
       LIMIT 1`,
      [scope.tenantId, scope.stepId, scope.tenantId, scope.turnId],
    );
    const rawAttemptMeta = attemptRow?.metadata_json;
    if (typeof rawAttemptMeta === "string" && rawAttemptMeta.trim().length > 0) {
      const parsed = JSON.parse(rawAttemptMeta) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const executor = (parsed as Record<string, unknown>)["executor"];
        if (executor && typeof executor === "object" && !Array.isArray(executor)) {
          const nodeId = (executor as Record<string, unknown>)["node_id"];
          if (typeof nodeId === "string" && nodeId.trim().length > 0) {
            executorNodeId = nodeId.trim();
          }
        }
      }
    }
  } catch {
    // Intentional: evidence sensitivity resolution is best-effort; fall back to defaults on any DB/JSON errors.
    executorNodeId = undefined;
  }

  if (!executorNodeId) {
    try {
      executorNodeId = await resolveExecutorNodeIdFromDispatchRecord(db, scope);
    } catch {
      // Intentional: evidence sensitivity resolution is best-effort; fall back to defaults on any DB/JSON errors.
      executorNodeId = undefined;
    }
  }

  if (!executorNodeId) {
    return resolveDesktopEvidenceSensitivityForMode(undefined);
  }

  let nodeMode: string | undefined;
  try {
    const pairingRow = await db.get<{ metadata_json: string | null }>(
      `SELECT metadata_json
       FROM node_pairings
       WHERE tenant_id = ?
         AND node_id = ?`,
      [scope.tenantId, executorNodeId],
    );
    const rawPairingMeta = pairingRow?.metadata_json;
    if (typeof rawPairingMeta === "string" && rawPairingMeta.trim().length > 0) {
      const parsed = JSON.parse(rawPairingMeta) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const mode = (parsed as Record<string, unknown>)["mode"];
        if (typeof mode === "string" && mode.trim().length > 0) {
          nodeMode = mode.trim();
        }
      }
    }
  } catch {
    // Intentional: evidence sensitivity resolution is best-effort; fall back to defaults on any DB/JSON errors.
    nodeMode = undefined;
  }

  return resolveDesktopEvidenceSensitivityForMode(nodeMode);
}

export async function shapeDesktopEvidenceForArtifacts(input: {
  db: SqlDb;
  artifactStore?: ArtifactStore;
  turnId: string;
  stepId: string;
  workspaceId?: string;
  fallbackScope?: ExecutionArtifactFallbackScope;
  evidence: unknown;
  result?: unknown;
  sensitivity: ExecutionArtifactSensitivity;
}): Promise<{ evidence: unknown; artifacts: ArtifactRefT[] }> {
  if (!input.artifactStore) return { evidence: input.evidence, artifacts: [] };

  const evidence = input.evidence;
  if (evidence === undefined) return { evidence, artifacts: [] };
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) {
    return { evidence, artifacts: [] };
  }

  const evidenceObj = evidence as Record<string, unknown>;
  const bytesBase64 =
    typeof evidenceObj["bytesBase64"] === "string" ? evidenceObj["bytesBase64"] : undefined;
  const treeFromEvidence = evidenceObj["tree"];
  const treeFromResult =
    input.result && typeof input.result === "object" && !Array.isArray(input.result)
      ? (input.result as Record<string, unknown>)["tree"]
      : undefined;
  const treeValue = treeFromEvidence !== undefined ? treeFromEvidence : treeFromResult;

  if (!bytesBase64 && treeValue === undefined) return { evidence, artifacts: [] };

  const mime = typeof evidenceObj["mime"] === "string" ? evidenceObj["mime"] : undefined;
  const evidenceType = typeof evidenceObj["type"] === "string" ? evidenceObj["type"] : "screenshot";
  const width = typeof evidenceObj["width"] === "number" ? evidenceObj["width"] : undefined;
  const height = typeof evidenceObj["height"] === "number" ? evidenceObj["height"] : undefined;
  const timestamp =
    typeof evidenceObj["timestamp"] === "string" ? evidenceObj["timestamp"] : undefined;

  const shaped: Record<string, unknown> = { ...evidenceObj };
  const artifacts: ArtifactRefT[] = [];

  if (bytesBase64) {
    delete shaped["bytesBase64"];

    let stored = null as Awaited<ReturnType<typeof persistExecutionArtifactBytes>>;
    try {
      stored = await persistExecutionArtifactBytes(input.db, input.artifactStore, {
        turnId: input.turnId,
        stepId: input.stepId,
        workspaceId: input.workspaceId,
        kind: "screenshot",
        body: Buffer.from(bytesBase64, "base64"),
        mimeType: mime ?? "image/png",
        labels: [evidenceType, "desktop"],
        metadata: {
          width,
          height,
          timestamp,
          mime: mime ?? "image/png",
          evidence_type: evidenceType,
        },
        sensitivity: input.sensitivity,
        fallbackScope: input.fallbackScope,
      });
    } catch {
      // Intentional: artifact byte persistence is best-effort; omit bytes when storage fails.
      stored = null;
    }

    if (!stored) {
      shaped["bytes_omitted"] = true;
    } else {
      shaped["artifact"] = stored;
      artifacts.push(stored);
    }
  }

  if (treeValue !== undefined) {
    if (treeFromEvidence !== undefined) {
      delete shaped["tree"];
    }

    const treeJson = (() => {
      if (typeof treeValue === "string") return treeValue;
      if (treeValue === null) return "null";
      return JSON.stringify(treeValue);
    })();

    let storedTree = null as Awaited<ReturnType<typeof persistExecutionArtifactBytes>>;
    try {
      storedTree = await persistExecutionArtifactBytes(input.db, input.artifactStore, {
        turnId: input.turnId,
        stepId: input.stepId,
        workspaceId: input.workspaceId,
        kind: "dom_snapshot",
        body: Buffer.from(treeJson, "utf8"),
        mimeType: "application/json",
        labels: ["a11y-tree", "desktop"],
        metadata: {
          timestamp,
          evidence_type: evidenceType,
        },
        sensitivity: input.sensitivity,
        fallbackScope: input.fallbackScope,
      });
    } catch {
      // Intentional: DOM snapshot persistence is best-effort; omit tree when storage fails.
      storedTree = null;
    }

    if (!storedTree) {
      shaped["tree_omitted"] = true;
    } else {
      shaped["tree_artifact"] = storedTree;
      artifacts.push(storedTree);
    }
  }

  return { evidence: shaped, artifacts };
}
