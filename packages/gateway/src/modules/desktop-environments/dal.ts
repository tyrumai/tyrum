import {
  DesktopEnvironment,
  DesktopEnvironmentHost,
  type DesktopEnvironment as DesktopEnvironmentT,
  type DesktopEnvironmentHost as DesktopEnvironmentHostT,
} from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { sqlBoolParam } from "../../statestore/sql.js";
import { requireTenantIdValue } from "../identity/scope.js";
import { randomUUID } from "node:crypto";

type RawHostRow = {
  host_id: string;
  label: string;
  version: string | null;
  docker_available: boolean | number;
  healthy: boolean | number;
  last_seen_at: string | Date | null;
  last_error: string | null;
};

type RawEnvironmentRow = {
  environment_id: string;
  host_id: string;
  label: string | null;
  image_ref: string;
  managed_kind: string;
  status: string;
  desired_running: boolean | number;
  node_id: string | null;
  takeover_url: string | null;
  last_seen_at: string | Date | null;
  last_error: string | null;
  logs_json: string;
  created_at: string | Date;
  updated_at: string | Date;
};

function toBoolean(value: boolean | number): boolean {
  return value === true || value === 1;
}

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toRequiredIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toHost(row: RawHostRow): DesktopEnvironmentHostT {
  return DesktopEnvironmentHost.parse({
    host_id: row.host_id,
    label: row.label,
    version: row.version,
    docker_available: toBoolean(row.docker_available),
    healthy: toBoolean(row.healthy),
    last_seen_at: toIso(row.last_seen_at),
    last_error: row.last_error,
  });
}

function toEnvironment(row: RawEnvironmentRow): DesktopEnvironmentT {
  return DesktopEnvironment.parse({
    environment_id: row.environment_id,
    host_id: row.host_id,
    label: row.label ?? undefined,
    image_ref: row.image_ref,
    managed_kind: row.managed_kind,
    status: row.status,
    desired_running: toBoolean(row.desired_running),
    node_id: row.node_id,
    takeover_url: row.takeover_url,
    last_seen_at: toIso(row.last_seen_at),
    last_error: row.last_error,
    created_at: toRequiredIso(row.created_at),
    updated_at: toRequiredIso(row.updated_at),
  });
}

function toEnvironmentWithTenant(
  row: RawEnvironmentRow & { tenant_id: string },
): DesktopEnvironmentT & {
  tenant_id: string;
} {
  const environment = toEnvironment(row);
  return {
    tenant_id: row.tenant_id,
    environment_id: environment.environment_id,
    host_id: environment.host_id,
    label: environment.label,
    image_ref: environment.image_ref,
    managed_kind: environment.managed_kind,
    status: environment.status,
    desired_running: environment.desired_running,
    node_id: environment.node_id,
    takeover_url: environment.takeover_url,
    last_seen_at: environment.last_seen_at,
    last_error: environment.last_error,
    created_at: environment.created_at,
    updated_at: environment.updated_at,
  };
}

export class DesktopEnvironmentHostDal {
  constructor(private readonly db: SqlDb) {}

  async get(hostId: string): Promise<DesktopEnvironmentHostT | undefined> {
    const row = await this.db.get<RawHostRow>(
      `SELECT host_id, label, version, docker_available, healthy, last_seen_at, last_error
       FROM desktop_environment_hosts
       WHERE host_id = ?`,
      [hostId],
    );
    return row ? toHost(row) : undefined;
  }

  async list(): Promise<DesktopEnvironmentHostT[]> {
    const rows = await this.db.all<RawHostRow>(
      `SELECT host_id, label, version, docker_available, healthy, last_seen_at, last_error
       FROM desktop_environment_hosts
       ORDER BY label ASC, host_id ASC`,
    );
    return rows.map(toHost);
  }

  async upsert(input: {
    hostId: string;
    label: string;
    version?: string | null;
    dockerAvailable: boolean;
    healthy: boolean;
    lastSeenAt?: string | null;
    lastError?: string | null;
  }): Promise<void> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO desktop_environment_hosts (
         host_id, label, version, docker_available, healthy, last_seen_at, last_error, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(host_id) DO UPDATE SET
         label = excluded.label,
         version = excluded.version,
         docker_available = excluded.docker_available,
         healthy = excluded.healthy,
         last_seen_at = excluded.last_seen_at,
         last_error = excluded.last_error,
         updated_at = excluded.updated_at`,
      [
        input.hostId,
        input.label,
        input.version ?? null,
        sqlBoolParam(this.db, input.dockerAvailable),
        sqlBoolParam(this.db, input.healthy),
        input.lastSeenAt ?? nowIso,
        input.lastError ?? null,
        nowIso,
      ],
    );
  }
}

export class DesktopEnvironmentDal {
  constructor(private readonly db: SqlDb) {}

  private requireTenantId(tenantId: string): string {
    return requireTenantIdValue(tenantId);
  }

  async list(tenantId: string): Promise<DesktopEnvironmentT[]> {
    const rows = await this.db.all<RawEnvironmentRow>(
      `SELECT environment_id, host_id, label, image_ref, managed_kind, status, desired_running,
              node_id, takeover_url, last_seen_at, last_error, logs_json, created_at, updated_at
       FROM desktop_environments
       WHERE tenant_id = ?
       ORDER BY updated_at DESC, environment_id DESC`,
      [this.requireTenantId(tenantId)],
    );
    return rows.map(toEnvironment);
  }

  async get(input: {
    tenantId: string;
    environmentId: string;
  }): Promise<DesktopEnvironmentT | undefined> {
    const row = await this.db.get<RawEnvironmentRow>(
      `SELECT environment_id, host_id, label, image_ref, managed_kind, status, desired_running,
              node_id, takeover_url, last_seen_at, last_error, logs_json, created_at, updated_at
       FROM desktop_environments
       WHERE tenant_id = ? AND environment_id = ?`,
      [this.requireTenantId(input.tenantId), input.environmentId],
    );
    return row ? toEnvironment(row) : undefined;
  }

  async create(input: {
    tenantId: string;
    hostId: string;
    label?: string;
    imageRef: string;
    desiredRunning: boolean;
  }): Promise<DesktopEnvironmentT> {
    const nowIso = new Date().toISOString();
    const row = await this.db.get<RawEnvironmentRow>(
      `INSERT INTO desktop_environments (
         environment_id, tenant_id, host_id, label, image_ref, managed_kind, status,
         desired_running, logs_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'docker', ?, ?, '[]', ?, ?)
       RETURNING environment_id, host_id, label, image_ref, managed_kind, status, desired_running,
                 node_id, takeover_url, last_seen_at, last_error, logs_json, created_at, updated_at`,
      [
        randomUUID(),
        this.requireTenantId(input.tenantId),
        input.hostId,
        input.label ?? null,
        input.imageRef,
        input.desiredRunning ? "starting" : "stopped",
        sqlBoolParam(this.db, input.desiredRunning),
        nowIso,
        nowIso,
      ],
    );
    if (!row) throw new Error("desktop environment insert failed");
    return toEnvironment(row);
  }

  async update(input: {
    tenantId: string;
    environmentId: string;
    label?: string;
    imageRef?: string;
    desiredRunning?: boolean;
  }): Promise<DesktopEnvironmentT | undefined> {
    const existing = await this.get({
      tenantId: input.tenantId,
      environmentId: input.environmentId,
    });
    if (!existing) return undefined;
    const nextImageRef = input.imageRef ?? existing.image_ref;
    const imageChanged = nextImageRef !== existing.image_ref;
    const desiredRunning = input.desiredRunning ?? existing.desired_running;
    const desiredRunningChanged = input.desiredRunning !== undefined;
    const imageChangedParam = sqlBoolParam(this.db, imageChanged);
    const desiredRunningChangedParam = sqlBoolParam(this.db, desiredRunningChanged);
    const row = await this.db.get<RawEnvironmentRow>(
      `UPDATE desktop_environments
       SET label = ?, image_ref = ?, desired_running = ?,
           status = CASE
             WHEN ? THEN ?
             WHEN ? THEN CASE
               WHEN ? THEN CASE WHEN status = 'running' THEN 'running' ELSE 'starting' END
               ELSE CASE WHEN status = 'stopped' THEN 'stopped' ELSE 'stopping' END
             END
             ELSE status
           END,
           node_id = CASE WHEN ? THEN NULL ELSE node_id END,
           takeover_url = CASE WHEN ? THEN NULL ELSE takeover_url END,
           last_seen_at = CASE WHEN ? THEN NULL ELSE last_seen_at END,
           last_error = CASE WHEN ? THEN NULL ELSE last_error END,
           logs_json = CASE WHEN ? THEN '[]' ELSE logs_json END,
           updated_at = ?
       WHERE tenant_id = ? AND environment_id = ?
       RETURNING environment_id, host_id, label, image_ref, managed_kind, status, desired_running,
                 node_id, takeover_url, last_seen_at, last_error, logs_json, created_at, updated_at`,
      [
        input.label ?? existing.label ?? null,
        nextImageRef,
        sqlBoolParam(this.db, desiredRunning),
        imageChangedParam,
        desiredRunning ? "pending" : "stopped",
        desiredRunningChangedParam,
        sqlBoolParam(this.db, desiredRunning),
        imageChangedParam,
        imageChangedParam,
        imageChangedParam,
        imageChangedParam,
        imageChangedParam,
        new Date().toISOString(),
        this.requireTenantId(input.tenantId),
        input.environmentId,
      ],
    );
    return row ? toEnvironment(row) : undefined;
  }

  async delete(input: { tenantId: string; environmentId: string }): Promise<boolean> {
    const result = await this.db.run(
      `DELETE FROM desktop_environments
       WHERE tenant_id = ? AND environment_id = ?`,
      [this.requireTenantId(input.tenantId), input.environmentId],
    );
    return result.changes > 0;
  }

  async start(input: {
    tenantId: string;
    environmentId: string;
  }): Promise<DesktopEnvironmentT | undefined> {
    return await this.update({ ...input, desiredRunning: true });
  }

  async stop(input: {
    tenantId: string;
    environmentId: string;
  }): Promise<DesktopEnvironmentT | undefined> {
    return await this.update({ ...input, desiredRunning: false });
  }

  async reset(input: {
    tenantId: string;
    environmentId: string;
  }): Promise<DesktopEnvironmentT | undefined> {
    const row = await this.db.get<RawEnvironmentRow>(
      `UPDATE desktop_environments
       SET status = CASE WHEN desired_running = ? THEN 'pending' ELSE 'stopped' END,
           node_id = NULL,
           takeover_url = NULL,
           last_seen_at = NULL,
           last_error = NULL,
           logs_json = '[]',
           updated_at = ?
       WHERE tenant_id = ? AND environment_id = ?
      RETURNING environment_id, host_id, label, image_ref, managed_kind, status, desired_running,
                 node_id, takeover_url, last_seen_at, last_error, logs_json, created_at, updated_at`,
      [
        sqlBoolParam(this.db, true),
        new Date().toISOString(),
        this.requireTenantId(input.tenantId),
        input.environmentId,
      ],
    );
    return row ? toEnvironment(row) : undefined;
  }

  async getLogs(input: { tenantId: string; environmentId: string }): Promise<string[]> {
    const row = await this.db.get<{ logs_json: string }>(
      `SELECT logs_json
       FROM desktop_environments
       WHERE tenant_id = ? AND environment_id = ?`,
      [this.requireTenantId(input.tenantId), input.environmentId],
    );
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.logs_json) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === "string")
        : [];
    } catch {
      // Intentional: malformed historical log payloads should not break the logs view.
      return [];
    }
  }

  async updateRuntime(input: {
    tenantId: string;
    environmentId: string;
    status: DesktopEnvironmentT["status"];
    nodeId?: string | null;
    takeoverUrl?: string | null;
    lastSeenAt?: string | null;
    lastError?: string | null;
    logs?: string[];
  }): Promise<void> {
    await this.db.run(
      `UPDATE desktop_environments
       SET status = ?, node_id = ?, takeover_url = ?, last_seen_at = ?, last_error = ?,
           logs_json = ?, updated_at = ?
       WHERE tenant_id = ? AND environment_id = ?`,
      [
        input.status,
        input.nodeId ?? null,
        input.takeoverUrl ?? null,
        input.lastSeenAt ?? new Date().toISOString(),
        input.lastError ?? null,
        JSON.stringify(input.logs ?? []),
        new Date().toISOString(),
        this.requireTenantId(input.tenantId),
        input.environmentId,
      ],
    );
  }

  async getByNodeId(
    nodeId: string,
    tenantId: string,
  ): Promise<(DesktopEnvironmentT & { tenant_id: string }) | undefined> {
    const row = await this.db.get<RawEnvironmentRow & { tenant_id: string }>(
      `SELECT tenant_id, environment_id, host_id, label, image_ref, managed_kind, status,
              desired_running, node_id, takeover_url, last_seen_at, last_error, logs_json,
              created_at, updated_at
       FROM desktop_environments
       WHERE tenant_id = ? AND node_id = ? AND desired_running = ${sqlBoolParam(this.db, true)}
       LIMIT 1`,
      [this.requireTenantId(tenantId), nodeId],
    );
    return row ? toEnvironmentWithTenant(row) : undefined;
  }

  async listByHost(hostId: string): Promise<Array<DesktopEnvironmentT & { tenant_id: string }>> {
    const rows = await this.db.all<RawEnvironmentRow & { tenant_id: string }>(
      `SELECT tenant_id, environment_id, host_id, label, image_ref, managed_kind, status,
              desired_running, node_id, takeover_url, last_seen_at, last_error, logs_json,
              created_at, updated_at
       FROM desktop_environments
       WHERE host_id = ?
      ORDER BY updated_at DESC, environment_id DESC`,
      [hostId],
    );
    return rows.map(toEnvironmentWithTenant);
  }
}

export type {
  DesktopEnvironmentT as DesktopEnvironment,
  DesktopEnvironmentHostT as DesktopEnvironmentHost,
};
