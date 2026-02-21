/**
 * Policy bundle management routes.
 *
 * Supports setting deployment/agent/playbook bundles that compose into an effective policy.
 */

import { Hono } from "hono";
import { PolicyBundle } from "@tyrum/schemas";
import type { SqlDb } from "../statestore/types.js";
import type { Logger } from "../modules/observability/logger.js";
import { PolicyBundleService } from "../modules/policy-bundle/service.js";

const SCOPE_KINDS = ["deployment", "agent", "playbook"] as const;
type ScopeKind = (typeof SCOPE_KINDS)[number];

function parseScopeKind(value: string | undefined): ScopeKind | undefined {
  if (value === "deployment" || value === "agent" || value === "playbook") return value;
  return undefined;
}

function parseScopeId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

export function createPolicyBundleRoutes(deps: {
  db: SqlDb;
  logger?: Logger;
}): Hono {
  const app = new Hono();
  const service = new PolicyBundleService(deps.db, { logger: deps.logger });

  app.get("/policy/bundles/:scope_kind/:scope_id", async (c) => {
    const scopeKind = parseScopeKind(c.req.param("scope_kind"));
    const scopeId = parseScopeId(c.req.param("scope_id"));
    if (!scopeKind || !scopeId) {
      return c.json({ error: "invalid_request", message: "invalid scope kind or scope id" }, 400);
    }

    const bundle = await service.getBundle({
      scopeKind,
      scopeId,
    });
    if (!bundle) {
      return c.json(
        {
          error: "not_found",
          message: `policy bundle ${scopeKind}/${scopeId} not found`,
        },
        404,
      );
    }

    return c.json({
      scope_kind: bundle.scopeKind,
      scope_id: bundle.scopeId,
      content_hash: bundle.contentHash,
      bundle: bundle.bundle,
    });
  });

  app.put("/policy/bundles/:scope_kind/:scope_id", async (c) => {
    const scopeKind = parseScopeKind(c.req.param("scope_kind"));
    const scopeId = parseScopeId(c.req.param("scope_id"));
    if (!scopeKind || !scopeId) {
      return c.json({ error: "invalid_request", message: "invalid scope kind or scope id" }, 400);
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request", message: "invalid JSON body" }, 400);
    }

    if (!raw || typeof raw !== "object") {
      return c.json({ error: "invalid_request", message: "expected JSON object body" }, 400);
    }

    const record = raw as Record<string, unknown>;
    const parsedBundle = PolicyBundle.safeParse(record["bundle"]);
    if (!parsedBundle.success) {
      return c.json({ error: "invalid_request", message: parsedBundle.error.message }, 400);
    }

    const rawFormat = record["format"];
    const format =
      typeof rawFormat === "string" && (rawFormat === "json" || rawFormat === "yaml")
        ? rawFormat
        : rawFormat === undefined
          ? undefined
          : null;
    if (format === null) {
      return c.json({ error: "invalid_request", message: "invalid format (expected json|yaml)" }, 400);
    }

    const res = await service.setBundle({
      scopeKind,
      scopeId,
      format,
      bundle: parsedBundle.data,
    });

    return c.json({ ok: true, content_hash: res.contentHash });
  });

  return app;
}
