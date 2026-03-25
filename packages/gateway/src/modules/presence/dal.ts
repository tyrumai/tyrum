import type { SqlDb } from "../../statestore/types.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";
import { Logger } from "../observability/logger.js";
import { gatewayMetrics } from "../observability/metrics.js";
import {
  parsePersistedJson,
  stringifyPersistedJson,
  type PersistedJsonObserver,
} from "../observability/persisted-json.js";

export type PresenceRole = "gateway" | "client" | "node";
const logger = new Logger({ base: { module: "presence.dal" } });

export interface PresenceRow {
  tenant_id: string;
  instance_id: string;
  role: PresenceRole;
  connection_id: string | null;
  host: string | null;
  ip: string | null;
  version: string | null;
  mode: string | null;
  last_input_seconds: number | null;
  metadata: unknown;
  connected_at_ms: number;
  last_seen_at_ms: number;
  expires_at_ms: number;
}

interface RawPresenceRow {
  tenant_id: string;
  instance_id: string;
  role: string;
  connection_id: string | null;
  host: string | null;
  ip: string | null;
  version: string | null;
  mode: string | null;
  last_input_seconds: number | null;
  metadata_json: string;
  connected_at_ms: number;
  last_seen_at_ms: number;
  expires_at_ms: number;
}

interface PresenceIdentity {
  tenant_id: string;
  instance_id: string;
}

export interface PresenceDalOptions extends PersistedJsonObserver {}

function parseMetadata(raw: string, observer: PersistedJsonObserver): unknown {
  return parsePersistedJson<Record<string, unknown>>({
    raw,
    fallback: {},
    table: "presence_entries",
    column: "metadata_json",
    shape: "object",
    observer,
  });
}

function normalizeTenantId(tenantId: string | null | undefined): string {
  const normalized = tenantId?.trim();
  return normalized ? normalized : DEFAULT_TENANT_ID;
}

function toPresenceRow(raw: RawPresenceRow, observer: PersistedJsonObserver): PresenceRow {
  const role = raw.role === "gateway" || raw.role === "node" ? raw.role : "client";
  return {
    tenant_id: raw.tenant_id,
    instance_id: raw.instance_id,
    role,
    connection_id: raw.connection_id,
    host: raw.host,
    ip: raw.ip,
    version: raw.version,
    mode: raw.mode,
    last_input_seconds: raw.last_input_seconds,
    metadata: parseMetadata(raw.metadata_json, observer),
    connected_at_ms: raw.connected_at_ms,
    last_seen_at_ms: raw.last_seen_at_ms,
    expires_at_ms: raw.expires_at_ms,
  };
}

export class PresenceDal {
  private readonly jsonObserver: PersistedJsonObserver;

  constructor(
    private readonly db: SqlDb,
    opts?: PresenceDalOptions,
  ) {
    this.jsonObserver = {
      logger: opts?.logger ?? logger,
      metrics: opts?.metrics ?? gatewayMetrics,
    };
  }

  private async resolveTenantId(params: {
    tenantId?: string | null;
    connectionId?: string | null;
  }): Promise<string> {
    const tenantId = params.tenantId?.trim();
    if (tenantId) return tenantId;

    const connectionId = params.connectionId?.trim();
    if (!connectionId) return DEFAULT_TENANT_ID;

    const row = await this.db.get<{ tenant_id: string }>(
      `SELECT tenant_id
       FROM connections
       WHERE connection_id = ?
       LIMIT 1`,
      [connectionId],
    );
    return row?.tenant_id?.trim() || DEFAULT_TENANT_ID;
  }

  async upsert(params: {
    tenantId?: string;
    instanceId: string;
    role: PresenceRole;
    connectionId?: string | null;
    host?: string | null;
    ip?: string | null;
    version?: string | null;
    mode?: string | null;
    lastInputSeconds?: number | null;
    metadata?: unknown;
    nowMs: number;
    ttlMs: number;
  }): Promise<PresenceRow> {
    const tenantId = await this.resolveTenantId({
      tenantId: params.tenantId,
      connectionId: params.connectionId,
    });
    const expiresAtMs = params.nowMs + Math.max(1, params.ttlMs);
    const metadataJson = stringifyPersistedJson({
      value: params.metadata ?? {},
      table: "presence_entries",
      column: "metadata_json",
      shape: "object",
    });
    const nowIso = new Date().toISOString();

    await this.db.run(
      `INSERT INTO presence_entries (
         tenant_id,
         instance_id,
         role,
         connection_id,
         host,
         ip,
         version,
         mode,
         last_input_seconds,
         metadata_json,
         connected_at_ms,
         last_seen_at_ms,
         expires_at_ms,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, instance_id) DO UPDATE SET
         role = excluded.role,
         connection_id = excluded.connection_id,
         host = COALESCE(excluded.host, presence_entries.host),
         ip = COALESCE(excluded.ip, presence_entries.ip),
         version = COALESCE(excluded.version, presence_entries.version),
         mode = COALESCE(excluded.mode, presence_entries.mode),
         last_input_seconds = COALESCE(excluded.last_input_seconds, presence_entries.last_input_seconds),
         metadata_json = excluded.metadata_json,
         connected_at_ms = excluded.connected_at_ms,
         last_seen_at_ms = excluded.last_seen_at_ms,
         expires_at_ms = excluded.expires_at_ms,
         updated_at = excluded.updated_at`,
      [
        tenantId,
        params.instanceId,
        params.role,
        params.connectionId ?? null,
        params.host ?? null,
        params.ip ?? null,
        params.version ?? null,
        params.mode ?? null,
        params.lastInputSeconds ?? null,
        metadataJson,
        params.nowMs,
        params.nowMs,
        expiresAtMs,
        nowIso,
      ],
    );

    const row = await this.getByInstanceId(params.instanceId, tenantId);
    if (!row) {
      throw new Error(`presence upsert failed for ${tenantId}:${params.instanceId}`);
    }
    return row;
  }

  async touch(params: {
    tenantId?: string;
    instanceId: string;
    nowMs: number;
    ttlMs: number;
  }): Promise<void> {
    const tenantId = normalizeTenantId(params.tenantId);
    const expiresAtMs = params.nowMs + Math.max(1, params.ttlMs);
    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE presence_entries
       SET last_seen_at_ms = ?, expires_at_ms = ?, updated_at = ?
       WHERE tenant_id = ? AND instance_id = ?`,
      [params.nowMs, expiresAtMs, nowIso, tenantId, params.instanceId],
    );
  }

  async markDisconnected(params: {
    tenantId?: string;
    instanceId: string;
    nowMs: number;
    ttlMs: number;
  }): Promise<void> {
    const tenantId = normalizeTenantId(params.tenantId);
    const expiresAtMs = params.nowMs + Math.max(1, params.ttlMs);
    const nowIso = new Date().toISOString();
    await this.db.run(
      `UPDATE presence_entries
       SET connection_id = NULL, last_seen_at_ms = ?, expires_at_ms = ?, updated_at = ?
       WHERE tenant_id = ? AND instance_id = ?`,
      [params.nowMs, expiresAtMs, nowIso, tenantId, params.instanceId],
    );
  }

  async getByInstanceId(instanceId: string, tenantId?: string): Promise<PresenceRow | undefined> {
    const normalizedTenantId = normalizeTenantId(tenantId);
    const row = await this.db.get<RawPresenceRow>(
      `SELECT *
       FROM presence_entries
       WHERE tenant_id = ? AND instance_id = ?`,
      [normalizedTenantId, instanceId],
    );
    return row ? toPresenceRow(row, this.jsonObserver) : undefined;
  }

  async listNonExpired(nowMs: number, limit = 200, tenantId?: string): Promise<PresenceRow[]> {
    const normalizedTenantId = normalizeTenantId(tenantId);
    const rows = await this.db.all<RawPresenceRow>(
      `SELECT *
       FROM presence_entries
       WHERE tenant_id = ? AND expires_at_ms > ?
       ORDER BY last_seen_at_ms DESC
       LIMIT ?`,
      [normalizedTenantId, nowMs, Math.max(1, Math.min(1000, limit))],
    );
    return rows.map((row) => toPresenceRow(row, this.jsonObserver));
  }

  async pruneExpired(nowMs: number): Promise<PresenceIdentity[]> {
    const expired = await this.db.all<PresenceIdentity>(
      `SELECT tenant_id, instance_id
       FROM presence_entries
       WHERE expires_at_ms <= ?
       ORDER BY expires_at_ms ASC, tenant_id ASC, instance_id ASC`,
      [nowMs],
    );
    if (expired.length === 0) {
      return [];
    }

    await this.db.run(
      `DELETE FROM presence_entries
       WHERE (tenant_id, instance_id) IN (${expired.map(() => "(?, ?)").join(", ")})`,
      expired.flatMap((row) => [row.tenant_id, row.instance_id]),
    );
    return expired;
  }

  async enforceCap(maxEntries: number): Promise<PresenceIdentity[]> {
    const cap = Math.max(1, Math.min(10_000, Math.floor(maxEntries)));
    const rows = await this.db.all<PresenceIdentity>(
      `SELECT tenant_id, instance_id
       FROM presence_entries
       ORDER BY tenant_id ASC, last_seen_at_ms DESC, instance_id ASC`,
    );
    if (rows.length === 0) return [];

    const perTenantSeen = new Map<string, number>();
    const toRemove: PresenceIdentity[] = [];
    for (const row of rows) {
      const seen = perTenantSeen.get(row.tenant_id) ?? 0;
      if (seen < cap) {
        perTenantSeen.set(row.tenant_id, seen + 1);
        continue;
      }
      toRemove.push(row);
    }

    for (const row of toRemove) {
      await this.db.run("DELETE FROM presence_entries WHERE tenant_id = ? AND instance_id = ?", [
        row.tenant_id,
        row.instance_id,
      ]);
    }
    return toRemove;
  }
}
