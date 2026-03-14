import type { AgentConfig as AgentConfigT, ExtensionKind as ExtensionKindT } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import { normalizeDbDateTime } from "../../utils/db-time.js";

type DefaultAccess = "allow" | "deny";

interface RawExtensionDefaultRow {
  tenant_id: string;
  kind: ExtensionKindT;
  extension_id: string;
  default_access: DefaultAccess | null;
  settings_json: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export type ExtensionDefaultRecord = {
  tenantId: string;
  kind: ExtensionKindT;
  extensionId: string;
  defaultAccess?: DefaultAccess;
  settings?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

function parseSettings(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function rowToRecord(row: RawExtensionDefaultRow): ExtensionDefaultRecord {
  const settings = parseSettings(row.settings_json);
  return {
    tenantId: row.tenant_id,
    kind: row.kind,
    extensionId: row.extension_id,
    ...(row.default_access ? { defaultAccess: row.default_access } : {}),
    ...(settings ? { settings } : {}),
    createdAt: normalizeDbDateTime(row.created_at),
    updatedAt: normalizeDbDateTime(row.updated_at),
  };
}

function hasExplicitAccess(
  access:
    | Pick<AgentConfigT["skills"], "allow" | "deny">
    | Pick<AgentConfigT["mcp"], "allow" | "deny">,
  extensionId: string,
): boolean {
  return access.allow.includes(extensionId) || access.deny.includes(extensionId);
}

function applyDefaultAccessToList<T extends { allow: string[]; deny: string[] }>(
  access: T,
  extensionId: string,
  defaultAccess: DefaultAccess | undefined,
): T {
  if (!defaultAccess || hasExplicitAccess(access, extensionId)) return access;
  if (defaultAccess === "allow") {
    return { ...access, allow: [...access.allow, extensionId] };
  }
  return { ...access, deny: [...access.deny, extensionId] };
}

export function applyExtensionDefaultsToConfig(
  config: AgentConfigT,
  defaults: readonly ExtensionDefaultRecord[],
): AgentConfigT {
  if (defaults.length === 0) return config;

  const skillDefaults = defaults.filter((item) => item.kind === "skill");
  const mcpDefaults = defaults.filter((item) => item.kind === "mcp");

  let nextSkills = {
    ...config.skills,
    allow: [...config.skills.allow],
    deny: [...config.skills.deny],
  };
  for (const item of skillDefaults) {
    nextSkills = applyDefaultAccessToList(nextSkills, item.extensionId, item.defaultAccess);
  }

  let nextMcp = {
    ...config.mcp,
    allow: [...config.mcp.allow],
    deny: [...config.mcp.deny],
    server_settings: { ...config.mcp.server_settings },
  };
  for (const item of mcpDefaults) {
    nextMcp = applyDefaultAccessToList(nextMcp, item.extensionId, item.defaultAccess);
    if (!nextMcp.server_settings[item.extensionId] && item.settings) {
      nextMcp.server_settings[item.extensionId] = item.settings;
    }
  }

  return {
    ...config,
    skills: nextSkills,
    mcp: nextMcp,
  };
}

export class ExtensionDefaultsDal {
  constructor(private readonly db: SqlDb) {}

  async list(tenantId: string, kind?: ExtensionKindT): Promise<ExtensionDefaultRecord[]> {
    const rows = await this.db.all<RawExtensionDefaultRow>(
      kind
        ? `SELECT tenant_id, kind, extension_id, default_access, settings_json, created_at, updated_at
             FROM extension_defaults
            WHERE tenant_id = ? AND kind = ?
            ORDER BY kind ASC, extension_id ASC`
        : `SELECT tenant_id, kind, extension_id, default_access, settings_json, created_at, updated_at
             FROM extension_defaults
            WHERE tenant_id = ?
            ORDER BY kind ASC, extension_id ASC`,
      kind ? [tenantId, kind] : [tenantId],
    );
    return rows.map(rowToRecord);
  }

  async get(params: {
    tenantId: string;
    kind: ExtensionKindT;
    extensionId: string;
  }): Promise<ExtensionDefaultRecord | undefined> {
    const row = await this.db.get<RawExtensionDefaultRow>(
      `SELECT tenant_id, kind, extension_id, default_access, settings_json, created_at, updated_at
         FROM extension_defaults
        WHERE tenant_id = ? AND kind = ? AND extension_id = ?
        LIMIT 1`,
      [params.tenantId, params.kind, params.extensionId],
    );
    return row ? rowToRecord(row) : undefined;
  }

  async set(params: {
    tenantId: string;
    kind: ExtensionKindT;
    extensionId: string;
    defaultAccess?: DefaultAccess;
    settings?: Record<string, unknown>;
  }): Promise<ExtensionDefaultRecord> {
    const settingsJson = params.settings ? JSON.stringify(params.settings) : null;
    const nowSql = this.db.kind === "sqlite" ? "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')" : "NOW()";
    const row = await this.db.get<RawExtensionDefaultRow>(
      this.db.kind === "sqlite"
        ? `INSERT INTO extension_defaults (
             tenant_id, kind, extension_id, default_access, settings_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ${nowSql}, ${nowSql})
           ON CONFLICT (tenant_id, kind, extension_id) DO UPDATE SET
             default_access = excluded.default_access,
             settings_json = excluded.settings_json,
             updated_at = ${nowSql}
           RETURNING tenant_id, kind, extension_id, default_access, settings_json, created_at, updated_at`
        : `INSERT INTO extension_defaults (
             tenant_id, kind, extension_id, default_access, settings_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, CAST(? AS JSONB), ${nowSql}, ${nowSql})
           ON CONFLICT (tenant_id, kind, extension_id) DO UPDATE SET
             default_access = excluded.default_access,
             settings_json = excluded.settings_json,
             updated_at = ${nowSql}
           RETURNING tenant_id, kind, extension_id, default_access, CAST(settings_json AS TEXT) AS settings_json, created_at, updated_at`,
      this.db.kind === "sqlite"
        ? [
            params.tenantId,
            params.kind,
            params.extensionId,
            params.defaultAccess ?? null,
            settingsJson,
          ]
        : [
            params.tenantId,
            params.kind,
            params.extensionId,
            params.defaultAccess ?? null,
            settingsJson,
          ],
    );
    if (!row) throw new Error("extension default upsert failed");
    return rowToRecord(row);
  }

  async delete(params: {
    tenantId: string;
    kind: ExtensionKindT;
    extensionId: string;
  }): Promise<void> {
    await this.db.run(
      `DELETE FROM extension_defaults
        WHERE tenant_id = ? AND kind = ? AND extension_id = ?`,
      [params.tenantId, params.kind, params.extensionId],
    );
  }
}

export async function resolveEffectiveAgentConfig(params: {
  db: SqlDb;
  tenantId: string;
  config: AgentConfigT;
}): Promise<AgentConfigT> {
  return applyExtensionDefaultsToConfig(
    params.config,
    await new ExtensionDefaultsDal(params.db).list(params.tenantId),
  );
}
