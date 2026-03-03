import type { ArtifactRef as ArtifactRefT } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import type { ArtifactStore } from "../artifact/store.js";
import {
  persistExecutionArtifactBytes,
  type ExecutionArtifactSensitivity,
} from "../artifact/execution-artifacts.js";

function parseEvidenceSensitivity(
  raw: string | undefined,
  fallback: ExecutionArtifactSensitivity,
): ExecutionArtifactSensitivity {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "normal" || normalized === "sensitive") return normalized;
  return fallback;
}

export function resolveBrowserEvidenceSensitivity(): ExecutionArtifactSensitivity {
  return parseEvidenceSensitivity(process.env["TYRUM_BROWSER_ARTIFACT_SENSITIVITY"], "sensitive");
}

export async function shapeBrowserEvidenceForArtifacts(input: {
  db: SqlDb;
  artifactStore?: ArtifactStore;
  runId: string;
  stepId: string;
  workspaceId?: string;
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
  if (!bytesBase64) return { evidence, artifacts: [] };

  const mime = typeof evidenceObj["mime"] === "string" ? evidenceObj["mime"] : undefined;
  const op = typeof evidenceObj["op"] === "string" ? evidenceObj["op"] : undefined;
  const timestamp =
    typeof evidenceObj["timestamp"] === "string" ? evidenceObj["timestamp"] : undefined;
  const width = typeof evidenceObj["width"] === "number" ? evidenceObj["width"] : undefined;
  const height = typeof evidenceObj["height"] === "number" ? evidenceObj["height"] : undefined;
  const durationMs =
    typeof evidenceObj["duration_ms"] === "number" ? evidenceObj["duration_ms"] : undefined;

  const shaped: Record<string, unknown> = { ...evidenceObj };
  const artifacts: ArtifactRefT[] = [];

  delete shaped["bytesBase64"];

  let stored = null as Awaited<ReturnType<typeof persistExecutionArtifactBytes>>;
  try {
    stored = await persistExecutionArtifactBytes(input.db, input.artifactStore, {
      runId: input.runId,
      stepId: input.stepId,
      workspaceId: input.workspaceId,
      kind: "file",
      body: Buffer.from(bytesBase64, "base64"),
      mimeType: mime ?? "application/octet-stream",
      labels: [op ?? "browser", "browser"],
      metadata: {
        op,
        mime: mime ?? "application/octet-stream",
        timestamp,
        width,
        height,
        duration_ms: durationMs,
      },
      sensitivity: input.sensitivity,
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

  return { evidence: shaped, artifacts };
}
