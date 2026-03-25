/**
 * Presence routes — best-effort view of connected instances.
 *
 * Presence is keyed by stable device identity (`instance_id`) when peers
 * connect via `connect.init/connect.proof` or send `presence.beacon` updates.
 *
 * Legacy `connect` peers (deprecated) may not appear in presence until they
 * migrate to device-proof handshakes.
 */

import { Hono } from "hono";
import { DEFAULT_TENANT_ID } from "../app/modules/identity/scope.js";
import type { PresenceDal } from "../app/modules/presence/dal.js";

export interface PresenceRouteDeps {
  instanceId: string;
  version: string;
  role: string;
  presenceDal: PresenceDal;
}

function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

function resolveOptionalTenantId(c: { get: (key: string) => unknown }): string | undefined {
  const claims = c.get("authClaims") as { tenant_id?: string | null } | undefined;
  const tenantId = claims?.tenant_id?.trim();
  return tenantId ? tenantId : undefined;
}

export function createPresenceRoutes(deps: PresenceRouteDeps): Hono {
  const app = new Hono();

  app.get("/presence", async (c) => {
    const nowMs = Date.now();
    const tenantId = resolveOptionalTenantId(c) ?? DEFAULT_TENANT_ID;
    const rows = await deps.presenceDal.listNonExpired(nowMs, 200, tenantId);

    const gatewayEntry = {
      instance_id: deps.instanceId,
      role: "gateway" as const,
      version: deps.version,
      mode: "backend" as const,
      last_seen_at: new Date().toISOString(),
      reason: "self" as const,
    };

    const peerEntries = rows.map((row) => {
      return {
        instance_id: row.instance_id,
        role: row.role,
        host: row.host ?? undefined,
        ip: row.ip ?? undefined,
        version: row.version ?? undefined,
        mode: row.mode ?? undefined,
        connected_at: msToIso(row.connected_at_ms),
        last_seen_at: msToIso(row.last_seen_at_ms),
        expires_at: msToIso(row.expires_at_ms),
        last_input_seconds: row.last_input_seconds ?? undefined,
        metadata: row.metadata,
      };
    });

    return c.json({
      status: "ok",
      generated_at: new Date().toISOString(),
      entries: [gatewayEntry, ...peerEntries],
    });
  });

  return app;
}
