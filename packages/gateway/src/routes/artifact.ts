/**
 * Execution artifact routes — fetch metadata and bytes for ArtifactStore-backed artifacts.
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { ArtifactId, ArtifactRef } from "@tyrum/schemas";
import type { ArtifactRef as ArtifactRefT, WsEventEnvelope } from "@tyrum/schemas";
import type { ArtifactStore } from "../modules/artifact/store.js";
import type { Logger } from "../modules/observability/logger.js";
import type { PolicySnapshotDal } from "../modules/policy/snapshot-dal.js";
import type { PolicyService } from "../modules/policy/service.js";
import type { SqlDb } from "../statestore/types.js";

export interface ArtifactRouteDeps {
  db: SqlDb;
  artifactStore: ArtifactStore;
  logger?: Logger;
  policySnapshotDal?: PolicySnapshotDal;
  policyService?: PolicyService;
}

type ExecutionArtifactRow = {
  artifact_id: string;
  workspace_id: string;
  agent_id: string | null;
  run_id: string | null;
  step_id: string | null;
  attempt_id: string | null;
  kind: string;
  uri: string;
  created_at: string | Date;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  labels_json: string;
  metadata_json: string;
  sensitivity: string;
  policy_snapshot_id: string | null;
};

type DurableExecutionScope = {
  run_id: string;
  step_id: string | null;
  attempt_id: string | null;
};

const ARTIFACT_NOT_FOUND_BODY = { error: "not_found", message: "artifact not found" } as const;

function normalizeDbDateTime(value: string | Date | null): string | null {
  if (value === null) return null;
  const raw = value instanceof Date ? value.toISOString() : value;
  // SQLite `datetime('now')` format: "YYYY-MM-DD HH:MM:SS" (UTC).
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    return `${raw.replace(" ", "T")}Z`;
  }
  return raw;
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToArtifactRef(row: ExecutionArtifactRow): ArtifactRefT | undefined {
  const labels = safeJsonParse(row.labels_json, [] as unknown[]);
  const metadata = safeJsonParse(row.metadata_json, undefined as unknown);

  const candidate = {
    artifact_id: row.artifact_id,
    uri: row.uri,
    kind: row.kind,
    created_at: normalizeDbDateTime(row.created_at) ?? new Date().toISOString(),
    mime_type: row.mime_type ?? undefined,
    size_bytes: row.size_bytes ?? undefined,
    sha256: row.sha256 ?? undefined,
    labels: Array.isArray(labels) ? labels.filter((l): l is string => typeof l === "string") : [],
    metadata,
  };

  const parsed = ArtifactRef.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

async function enqueueWsEvent(db: SqlDb, evt: WsEventEnvelope): Promise<void> {
  await db.run(
    `INSERT INTO outbox (topic, target_edge_id, payload_json)
     VALUES (?, ?, ?)`,
    ["ws.broadcast", null, JSON.stringify({ message: evt })],
  );
}

async function evaluateAccessDecision(
  deps: ArtifactRouteDeps,
  row: ExecutionArtifactRow,
): Promise<"allow" | "require_approval" | "deny"> {
  const snapshotId = row.policy_snapshot_id;
  if (!snapshotId || !deps.policySnapshotDal) return "allow";

  const snapshot = await deps.policySnapshotDal.getById(snapshotId);
  if (!snapshot) return "allow";

  const decision = snapshot.bundle.artifacts?.default ?? "allow";
  return decision;
}

async function resolveDurableExecutionScope(
  deps: ArtifactRouteDeps,
  row: ExecutionArtifactRow,
): Promise<DurableExecutionScope | null> {
  if (row.attempt_id) {
    const attemptScope = await deps.db.get<{ run_id: string; step_id: string }>(
      `SELECT s.run_id AS run_id, a.step_id AS step_id
       FROM execution_attempts a
       JOIN execution_steps s ON s.step_id = a.step_id
       WHERE a.attempt_id = ?`,
      [row.attempt_id],
    );
    if (!attemptScope) return null;
    if (row.step_id && row.step_id !== attemptScope.step_id) return null;
    if (row.run_id && row.run_id !== attemptScope.run_id) return null;
    return {
      run_id: attemptScope.run_id,
      step_id: attemptScope.step_id,
      attempt_id: row.attempt_id,
    };
  }

  if (row.step_id) {
    const stepScope = await deps.db.get<{ run_id: string }>(
      "SELECT run_id FROM execution_steps WHERE step_id = ?",
      [row.step_id],
    );
    if (!stepScope) return null;
    if (row.run_id && row.run_id !== stepScope.run_id) return null;
    return {
      run_id: stepScope.run_id,
      step_id: row.step_id,
      attempt_id: null,
    };
  }

  if (row.run_id) {
    const runScope = await deps.db.get<{ run_id: string }>(
      "SELECT run_id FROM execution_runs WHERE run_id = ?",
      [row.run_id],
    );
    if (!runScope) return null;
    return {
      run_id: runScope.run_id,
      step_id: null,
      attempt_id: null,
    };
  }

  return null;
}

export function createArtifactRoutes(deps: ArtifactRouteDeps): Hono {
  const app = new Hono();

  app.get("/artifacts/:id/metadata", async (c) => {
    return c.json(
      {
        error: "invalid_request",
        message:
          "artifact fetch APIs must be scope-bound; use GET /runs/:runId/artifacts/:id/metadata",
      },
      400,
    );
  });

  app.get("/artifacts/:id", async (c) => {
    return c.json(
      {
        error: "invalid_request",
        message:
          "artifact fetch APIs must be scope-bound; use GET /runs/:runId/artifacts/:id",
      },
      400,
    );
  });

  app.get("/runs/:runId/artifacts/:id/metadata", async (c) => {
    const runId = c.req.param("runId")?.trim();
    if (!runId) {
      return c.json({ error: "invalid_request", message: "invalid run id" }, 400);
    }

    const artifactId = c.req.param("id");
    const parsedId = ArtifactId.safeParse(artifactId);
    if (!parsedId.success) {
      return c.json({ error: "invalid_request", message: "invalid artifact id" }, 400);
    }

    const row = await deps.db.get<ExecutionArtifactRow>(
      "SELECT * FROM execution_artifacts WHERE artifact_id = ?",
      [parsedId.data],
    );
    if (!row) {
      return c.json(ARTIFACT_NOT_FOUND_BODY, 404);
    }

    const durableScope = await resolveDurableExecutionScope(deps, row);
    if (!durableScope) {
      return c.json(
        {
          error: "forbidden",
          message: "artifact access denied: durable execution scope linkage is required",
        },
        403,
      );
    }
    if (durableScope.run_id !== runId) {
      return c.json(ARTIFACT_NOT_FOUND_BODY, 404);
    }

    if (deps.policyService?.isEnabled() && !deps.policyService.isObserveOnly()) {
      const decision = await evaluateAccessDecision(deps, row);
      if (decision !== "allow") {
        const code = decision === "deny" ? "forbidden" : "require_approval";
        return c.json(
          {
            error: code,
            message:
              decision === "deny"
                ? "artifact access denied by policy"
                : "artifact access requires approval",
          },
          403,
        );
      }
    }

    const ref = rowToArtifactRef(row);
    if (!ref) {
      return c.json({ error: "invalid_state", message: "artifact metadata is invalid" }, 500);
    }

    return c.json(
      {
        artifact: ref,
        scope: {
          workspace_id: row.workspace_id,
          agent_id: row.agent_id,
          run_id: durableScope.run_id,
          step_id: durableScope.step_id,
          attempt_id: durableScope.attempt_id,
          sensitivity: row.sensitivity,
          policy_snapshot_id: row.policy_snapshot_id,
        },
      },
      200,
    );
  });

  app.get("/runs/:runId/artifacts/:id", async (c) => {
    const runId = c.req.param("runId")?.trim();
    if (!runId) {
      return c.json({ error: "invalid_request", message: "invalid run id" }, 400);
    }

    const artifactId = c.req.param("id");
    const parsedId = ArtifactId.safeParse(artifactId);
    if (!parsedId.success) {
      return c.json({ error: "invalid_request", message: "invalid artifact id" }, 400);
    }

    const row = await deps.db.get<ExecutionArtifactRow>(
      "SELECT * FROM execution_artifacts WHERE artifact_id = ?",
      [parsedId.data],
    );
    if (!row) {
      return c.json(ARTIFACT_NOT_FOUND_BODY, 404);
    }

    const durableScope = await resolveDurableExecutionScope(deps, row);
    if (!durableScope) {
      return c.json(
        {
          error: "forbidden",
          message: "artifact access denied: durable execution scope linkage is required",
        },
        403,
      );
    }
    if (durableScope.run_id !== runId) {
      return c.json(ARTIFACT_NOT_FOUND_BODY, 404);
    }

    if (deps.policyService?.isEnabled() && !deps.policyService.isObserveOnly()) {
      const decision = await evaluateAccessDecision(deps, row);
      if (decision !== "allow") {
        const code = decision === "deny" ? "forbidden" : "require_approval";
        return c.json(
          {
            error: code,
            message:
              decision === "deny"
                ? "artifact access denied by policy"
                : "artifact access requires approval",
          },
          403,
        );
      }
    }

    const stored = await deps.artifactStore.get(parsedId.data);
    if (!stored) {
      return c.json({ error: "not_found", message: "artifact bytes not found" }, 404);
    }

    const ref = rowToArtifactRef(row) ?? stored.ref;

    // Conservative: prevent caches from persisting potentially sensitive artifacts.
    c.header("Cache-Control", "no-store");
    c.header("Content-Type", ref.mime_type ?? "application/octet-stream");
    c.header("Content-Length", String(stored.body.byteLength));

    // Best-effort: emit an audit-style event.
    try {
      const evt: WsEventEnvelope = {
        event_id: randomUUID(),
        type: "artifact.fetched",
        occurred_at: new Date().toISOString(),
        scope: { kind: "run", run_id: durableScope.run_id },
        payload: {
          artifact: ref,
          fetched_by: {
            kind: "http",
            request_id: c.res.headers.get("x-request-id") ?? undefined,
          },
        },
      };
      await enqueueWsEvent(deps.db, evt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.warn("artifact.fetched_emit_failed", {
        artifact_id: parsedId.data,
        error: message,
      });
    }

    const bytes = new Uint8Array(
      stored.body.buffer as ArrayBuffer,
      stored.body.byteOffset,
      stored.body.byteLength,
    );
    return c.body(bytes);
  });

  return app;
}
