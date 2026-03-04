import type { ClientCapability } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";

export interface ConnectionDirectoryRow {
  connection_id: string;
  edge_id: string;
  role: "client" | "node";
  protocol_rev: number;
  device_id: string | null;
  pubkey: string | null;
  label: string | null;
  version: string | null;
  mode: string | null;
  capabilities: ClientCapability[];
  ready_capabilities: ClientCapability[];
  connected_at_ms: number;
  last_seen_at_ms: number;
  expires_at_ms: number;
}

interface RawConnectionDirectoryRow {
  tenant_id: string;
  connection_id: string;
  edge_id: string;
  role: string;
  protocol_rev: number;
  pubkey: string | null;
  label: string | null;
  principal_key: string;
  metadata_json: string;
  capabilities_json: string;
  ready_capabilities_json: string | null;
  connected_at_ms: number;
  last_seen_at_ms: number;
  expires_at_ms: number;
}

function safeParseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    // Intentional: treat malformed JSON as empty metadata for rolling upgrade safety.
    return {};
  }
}

function toRow(raw: RawConnectionDirectoryRow): ConnectionDirectoryRow {
  let capabilities: ClientCapability[] = [];
  try {
    const parsed = JSON.parse(raw.capabilities_json) as unknown;
    if (Array.isArray(parsed)) {
      capabilities = parsed.filter(
        (v): v is ClientCapability => typeof v === "string",
      ) as ClientCapability[];
    }
  } catch {
    // Intentional: treat invalid JSON columns as empty capabilities.
  }
  let readyCapabilities: ClientCapability[] | undefined;
  if (typeof raw.ready_capabilities_json === "string") {
    try {
      const parsed = JSON.parse(raw.ready_capabilities_json) as unknown;
      if (Array.isArray(parsed)) {
        readyCapabilities = parsed.filter(
          (v): v is ClientCapability => typeof v === "string",
        ) as ClientCapability[];
      }
    } catch {
      // Intentional: treat invalid JSON columns as missing so callers fall back to advertised capabilities.
    }
  }
  const role = raw.role === "node" ? "node" : "client";
  const metadata = safeParseJsonObject(raw.metadata_json);
  const version = typeof metadata.version === "string" ? metadata.version : null;
  const mode = typeof metadata.mode === "string" ? metadata.mode : null;
  const deviceId = raw.principal_key === raw.connection_id ? null : raw.principal_key;
  return {
    connection_id: raw.connection_id,
    edge_id: raw.edge_id,
    role,
    protocol_rev:
      typeof raw.protocol_rev === "number" && Number.isFinite(raw.protocol_rev)
        ? raw.protocol_rev
        : 1,
    device_id: deviceId,
    pubkey: raw.pubkey,
    label: raw.label,
    version,
    mode,
    capabilities,
    ready_capabilities: readyCapabilities ?? capabilities,
    connected_at_ms: raw.connected_at_ms,
    last_seen_at_ms: raw.last_seen_at_ms,
    expires_at_ms: raw.expires_at_ms,
  };
}

export class ConnectionDirectoryDal {
  constructor(private readonly db: SqlDb) {}

  async upsertConnection(params: {
    tenantId?: string;
    connectionId: string;
    edgeId: string;
    role: "client" | "node";
    protocolRev?: number;
    deviceId?: string | null;
    pubkey?: string | null;
    label?: string | null;
    version?: string | null;
    mode?: string | null;
    capabilities: readonly ClientCapability[];
    readyCapabilities?: readonly ClientCapability[];
    nowMs: number;
    ttlMs: number;
  }): Promise<void> {
    const tenantId = params.tenantId ?? DEFAULT_TENANT_ID;
    const principalKey = params.deviceId ?? params.connectionId;
    const role = params.role;

    const existingPrincipal = await this.db.get<{ principal_id: string }>(
      `SELECT principal_id
       FROM principals
       WHERE tenant_id = ? AND kind = ? AND principal_key = ?
       LIMIT 1`,
      [tenantId, role, principalKey],
    );
    const principalId = existingPrincipal?.principal_id ?? crypto.randomUUID();

    const metadataJson = JSON.stringify({
      ...(params.version ? { version: params.version } : {}),
      ...(params.mode ? { mode: params.mode } : {}),
    });

    if (existingPrincipal) {
      await this.db.run(
        `UPDATE principals
         SET status = ?, label = ?, pubkey = ?, metadata_json = ?
         WHERE tenant_id = ? AND principal_id = ?`,
        [
          "active",
          params.label ?? null,
          params.pubkey ?? null,
          metadataJson,
          tenantId,
          principalId,
        ],
      );
    } else {
      await this.db.run(
        `INSERT INTO principals (
           tenant_id,
           principal_id,
           kind,
           principal_key,
           status,
           label,
           pubkey,
           metadata_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          principalId,
          role,
          principalKey,
          "active",
          params.label ?? null,
          params.pubkey ?? null,
          metadataJson,
        ],
      );
    }

    const expiresAtMs = params.nowMs + params.ttlMs;
    const readyCapabilities = params.readyCapabilities ?? params.capabilities ?? [];
    await this.db.run(
      `INSERT INTO connections (
         tenant_id,
         connection_id,
         edge_id,
         principal_id,
         protocol_rev,
         capabilities_json,
         ready_capabilities_json,
         connected_at_ms,
         last_seen_at_ms,
         expires_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, connection_id) DO UPDATE SET
         edge_id = excluded.edge_id,
         principal_id = excluded.principal_id,
         protocol_rev = excluded.protocol_rev,
         capabilities_json = excluded.capabilities_json,
         ready_capabilities_json = excluded.ready_capabilities_json,
         last_seen_at_ms = excluded.last_seen_at_ms,
         expires_at_ms = excluded.expires_at_ms`,
      [
        tenantId,
        params.connectionId,
        params.edgeId,
        principalId,
        params.protocolRev ?? 1,
        JSON.stringify(params.capabilities ?? []),
        JSON.stringify(readyCapabilities),
        params.nowMs,
        params.nowMs,
        expiresAtMs,
      ],
    );
  }

  async setReadyCapabilities(params: {
    tenantId?: string;
    connectionId: string;
    readyCapabilities: readonly ClientCapability[];
  }): Promise<void> {
    const tenantId = params.tenantId ?? DEFAULT_TENANT_ID;
    await this.db.run(
      `UPDATE connections
       SET ready_capabilities_json = ?
       WHERE tenant_id = ? AND connection_id = ?`,
      [JSON.stringify(params.readyCapabilities ?? []), tenantId, params.connectionId],
    );
  }

  async touchConnection(params: {
    tenantId?: string;
    connectionId: string;
    nowMs: number;
    ttlMs: number;
  }): Promise<void> {
    const tenantId = params.tenantId ?? DEFAULT_TENANT_ID;
    const expiresAtMs = params.nowMs + params.ttlMs;
    await this.db.run(
      `UPDATE connections
       SET last_seen_at_ms = ?, expires_at_ms = ?
       WHERE tenant_id = ? AND connection_id = ?`,
      [params.nowMs, expiresAtMs, tenantId, params.connectionId],
    );
  }

  async removeConnection(connectionId: string, opts?: { tenantId?: string }): Promise<void> {
    const tenantId = opts?.tenantId ?? DEFAULT_TENANT_ID;
    await this.db.run("DELETE FROM connections WHERE tenant_id = ? AND connection_id = ?", [
      tenantId,
      connectionId,
    ]);
  }

  async cleanupExpired(nowMs: number): Promise<number> {
    return (
      await this.db.run("DELETE FROM connections WHERE tenant_id = ? AND expires_at_ms <= ?", [
        DEFAULT_TENANT_ID,
        nowMs,
      ])
    ).changes;
  }

  async listNonExpired(nowMs: number): Promise<ConnectionDirectoryRow[]> {
    const rows = await this.db.all<RawConnectionDirectoryRow>(
      `SELECT
         c.tenant_id,
         c.connection_id,
         c.edge_id,
         p.kind AS role,
         c.protocol_rev,
         p.pubkey,
         p.label,
         p.principal_key,
         p.metadata_json,
         c.capabilities_json,
         c.ready_capabilities_json,
         c.connected_at_ms,
         c.last_seen_at_ms,
         c.expires_at_ms
       FROM connections c
       JOIN principals p
         ON p.tenant_id = c.tenant_id AND p.principal_id = c.principal_id
       WHERE c.tenant_id = ? AND c.expires_at_ms > ?
       ORDER BY c.last_seen_at_ms DESC`,
      [DEFAULT_TENANT_ID, nowMs],
    );
    return rows.map(toRow);
  }

  async listConnectionsForCapability(
    capability: ClientCapability,
    nowMs: number,
    opts?: { role?: "client" | "node" },
  ): Promise<ConnectionDirectoryRow[]> {
    const rows = await this.listNonExpired(nowMs);
    return rows.filter(
      (r) => r.capabilities.includes(capability) && (opts?.role ? r.role === opts.role : true),
    );
  }
}
