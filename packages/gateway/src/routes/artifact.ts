/**
 * Generic artifact routes — capability bytes fetch plus authenticated metadata lookup.
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import {
  ArtifactId,
  artifactFilenameFromMetadata,
  ArtifactKind,
  ArtifactMediaClass,
  ArtifactRef,
  AuthTokenClaims,
  artifactMediaClassFromMimeType,
} from "@tyrum/contracts";
import type {
  ArtifactRef as ArtifactRefT,
  AuthTokenClaims as AuthTokenClaimsT,
  WsEventEnvelope,
} from "@tyrum/contracts";
import type { ArtifactStore } from "../app/modules/artifact/store.js";
import type { Logger } from "../app/modules/observability/logger.js";
import type { PolicySnapshotDal } from "../app/modules/policy/snapshot-dal.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { SqlDb } from "../statestore/types.js";
import { normalizeDbDateTime } from "../utils/db-time.js";
import { safeJsonParse } from "../utils/json.js";
import { enqueueWsBroadcastMessage } from "../ws/outbox.js";
import { requireTenantId } from "../app/modules/auth/claims.js";
import type { ArtifactRow } from "../app/modules/artifact/dal.js";

export interface ArtifactRouteDeps {
  db: SqlDb;
  artifactStore: ArtifactStore;
  publicBaseUrl: string;
  logger?: Logger;
  policySnapshotDal?: PolicySnapshotDal;
  policyService?: PolicyService;
}

type ArtifactLinkRow = {
  parent_kind: string;
  parent_id: string;
};

const ARTIFACT_NOT_FOUND_BODY = { error: "not_found", message: "artifact not found" } as const;
const DEFAULT_SIGNED_URL_TTL_SECONDS = 60;

function artifactMediaClassFromRow(
  row: Pick<ArtifactRow, "media_class" | "mime_type" | "filename">,
): ArtifactRefT["media_class"] {
  const parsed = ArtifactMediaClass.safeParse(row.media_class?.trim());
  return parsed.success
    ? parsed.data
    : artifactMediaClassFromMimeType(row.mime_type ?? undefined, row.filename ?? undefined);
}

function rowToArtifactRef(row: ArtifactRow): ArtifactRefT | undefined {
  const labels = safeJsonParse(row.labels_json, [] as unknown[]);
  const metadata = safeJsonParse(row.metadata_json, undefined as unknown);
  const kindCandidate = ArtifactKind.safeParse(row.kind);
  if (!kindCandidate.success) {
    return undefined;
  }
  const filename = artifactFilenameFromMetadata({
    artifactId: row.artifact_id,
    kind: kindCandidate.data,
    filename: row.filename ?? undefined,
    mimeType: row.mime_type ?? undefined,
  });

  const candidate = {
    artifact_id: row.artifact_id,
    uri: row.uri,
    external_url: row.external_url,
    kind: kindCandidate.data,
    media_class: artifactMediaClassFromRow(row),
    created_at: normalizeDbDateTime(row.created_at) ?? new Date().toISOString(),
    filename,
    mime_type: row.mime_type ?? undefined,
    size_bytes: row.size_bytes ?? undefined,
    sha256: row.sha256 ?? undefined,
    labels: Array.isArray(labels) ? labels.filter((l): l is string => typeof l === "string") : [],
    metadata,
  };

  const parsed = ArtifactRef.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function requestIdForAudit(c: {
  req: { header(name: string): string | undefined };
  res: { headers: Headers };
}): string | undefined {
  const fromRequest = c.req.header("x-request-id")?.trim();
  if (fromRequest) return fromRequest;
  const fromResponse = c.res.headers.get("x-request-id")?.trim();
  if (fromResponse) return fromResponse;
  return undefined;
}

function authClaimsForAudit(c: { get?: (key: string) => unknown }): AuthTokenClaimsT | undefined {
  const rawGet = c.get;
  if (typeof rawGet !== "function") return undefined;
  try {
    const raw = rawGet.call(c, "authClaims") as unknown;
    const parsed = AuthTokenClaims.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  } catch (err) {
    void err;
    // Intentional: audit enrichment must never block artifact responses.
    return undefined;
  }
}

async function getArtifactRowById(
  deps: ArtifactRouteDeps,
  tenantId: string,
  artifactId: string,
): Promise<ArtifactRow | undefined> {
  return await deps.db.get<ArtifactRow>(
    "SELECT * FROM artifacts WHERE tenant_id = ? AND artifact_id = ?",
    [tenantId, artifactId],
  );
}

async function getArtifactRowByAccessId(
  deps: ArtifactRouteDeps,
  accessId: string,
  tenantId?: string,
): Promise<ArtifactRow | undefined> {
  if (tenantId) {
    return await deps.db.get<ArtifactRow>(
      "SELECT * FROM artifacts WHERE tenant_id = ? AND access_id = ?",
      [tenantId, accessId],
    );
  }

  return await deps.db.get<ArtifactRow>("SELECT * FROM artifacts WHERE access_id = ?", [accessId]);
}

async function listArtifactLinks(
  deps: ArtifactRouteDeps,
  tenantId: string,
  artifactId: string,
): Promise<ArtifactLinkRow[]> {
  return await deps.db.all<ArtifactLinkRow>(
    `SELECT parent_kind, parent_id
     FROM artifact_links
     WHERE tenant_id = ?
       AND artifact_id = ?
     ORDER BY parent_kind ASC, parent_id ASC`,
    [tenantId, artifactId],
  );
}

async function emitArtifactFetched(input: {
  deps: ArtifactRouteDeps;
  tenantId: string;
  row: ArtifactRow;
  artifact: ArtifactRefT;
  requestId: string | undefined;
  auth: AuthTokenClaimsT | undefined;
}): Promise<void> {
  try {
    const evt: WsEventEnvelope = {
      event_id: randomUUID(),
      type: "artifact.fetched",
      occurred_at: new Date().toISOString(),
      scope: input.row.agent_id
        ? { kind: "agent", agent_id: input.row.agent_id }
        : { kind: "global" },
      payload: {
        artifact: input.artifact,
        policy_snapshot_id: input.row.policy_snapshot_id ?? null,
        fetched_by: {
          kind: input.auth ? "http" : "capability",
          request_id: input.requestId,
          access_id: input.row.access_id,
          ...(input.auth ? { auth: input.auth } : {}),
        },
      },
    };
    await enqueueWsBroadcastMessage(input.deps.db, input.tenantId, evt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    input.deps.logger?.warn("artifact.fetched_emit_failed", {
      artifact_id: input.row.artifact_id,
      error: message,
    });
  }
}

export function createArtifactRoutes(deps: ArtifactRouteDeps): Hono {
  const app = new Hono();

  app.get("/artifacts/:id/metadata", async (c) => {
    const tenantId = requireTenantId(c);
    const artifactId = c.req.param("id");
    const parsedId = ArtifactId.safeParse(artifactId);
    if (!parsedId.success) {
      return c.json({ error: "invalid_request", message: "invalid artifact id" }, 400);
    }

    const row = await getArtifactRowById(deps, tenantId, parsedId.data);
    if (!row) {
      return c.json(ARTIFACT_NOT_FOUND_BODY, 404);
    }

    const ref = rowToArtifactRef(row);
    if (!ref) {
      return c.json({ error: "invalid_state", message: "artifact metadata is invalid" }, 500);
    }

    return c.json(
      {
        artifact: ref,
        sensitivity: row.sensitivity,
        links: await listArtifactLinks(deps, tenantId, row.artifact_id),
      },
      200,
    );
  });

  app.get("/a/:id", async (c) => {
    const accessId = c.req.param("id");
    const parsedId = ArtifactId.safeParse(accessId);
    if (!parsedId.success) {
      return c.json({ error: "invalid_request", message: "invalid artifact id" }, 400);
    }

    const auth = authClaimsForAudit(c);
    const tenantId =
      auth && typeof auth.tenant_id === "string" && auth.tenant_id.trim().length > 0
        ? auth.tenant_id
        : undefined;
    const row = await getArtifactRowByAccessId(deps, parsedId.data, tenantId);
    if (!row) {
      return c.json(ARTIFACT_NOT_FOUND_BODY, 404);
    }

    const ref = rowToArtifactRef(row);
    if (!ref) {
      return c.json({ error: "invalid_state", message: "artifact metadata is invalid" }, 500);
    }
    const requestId = requestIdForAudit(c);

    const getSignedUrl = deps.artifactStore.getSignedUrl;
    if (typeof getSignedUrl === "function") {
      const signedUrl = await getSignedUrl.call(deps.artifactStore, row.artifact_id, {
        expiresInSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
      });
      if (!signedUrl) {
        return c.json({ error: "not_found", message: "artifact bytes not found" }, 404);
      }
      c.header("Cache-Control", "no-store");
      await emitArtifactFetched({
        deps,
        tenantId: row.tenant_id,
        row,
        artifact: ref,
        requestId,
        auth,
      });
      return c.redirect(signedUrl, 302);
    }

    const stored = await deps.artifactStore.get(row.artifact_id);
    if (!stored) {
      return c.json({ error: "not_found", message: "artifact bytes not found" }, 404);
    }

    c.header("Cache-Control", "no-store");
    c.header("Content-Type", ref.mime_type ?? "application/octet-stream");
    c.header("Content-Length", String(stored.body.byteLength));
    if (ref.filename) {
      c.header("Content-Disposition", `inline; filename="${ref.filename.replaceAll('"', "")}"`);
    }

    await emitArtifactFetched({
      deps,
      tenantId: row.tenant_id,
      row,
      artifact: ref,
      requestId,
      auth,
    });

    const bytes = new Uint8Array(
      stored.body.buffer as ArrayBuffer,
      stored.body.byteOffset,
      stored.body.byteLength,
    );
    return c.body(bytes);
  });

  return app;
}
