import type { SqlDb } from "../../statestore/types.js";
import { safeJsonParse } from "../../utils/json.js";

export interface OAuthProviderSpec {
  tenant_id: string;
  provider_id: string;
  display_name?: string;
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  device_authorization_endpoint?: string;
  scopes: string[];
  client_id: string;
  client_secret_key?: string;
  token_endpoint_basic_auth: boolean;
  extra_authorize_params?: Record<string, string>;
  extra_token_params?: Record<string, string>;
}

interface RawOAuthProviderConfigRow {
  tenant_id: string;
  provider_id: string;
  display_name: string | null;
  issuer: string | null;
  authorization_endpoint: string | null;
  token_endpoint: string | null;
  device_authorization_endpoint: string | null;
  scopes_json: string;
  client_id: string;
  client_secret_key: string | null;
  token_endpoint_basic_auth: number | boolean;
  extra_authorize_params_json: string;
  extra_token_params_json: string;
}

function parseScopesJson(raw: string | null | undefined): string[] {
  const parsed = safeJsonParse<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

function parseParamsJson(raw: string | null | undefined): Record<string, string> | undefined {
  const parsed = safeJsonParse<unknown>(raw, {});
  if (!parsed || typeof parsed !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const key = k.trim();
    if (key.length === 0) continue;
    if (typeof v !== "string") continue;
    const value = v.trim();
    if (value.length === 0) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeOptionalString(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function rowToSpec(row: RawOAuthProviderConfigRow): OAuthProviderSpec {
  return {
    tenant_id: row.tenant_id,
    provider_id: row.provider_id,
    display_name: normalizeOptionalString(row.display_name),
    issuer: normalizeOptionalString(row.issuer),
    authorization_endpoint: normalizeOptionalString(row.authorization_endpoint),
    token_endpoint: normalizeOptionalString(row.token_endpoint),
    device_authorization_endpoint: normalizeOptionalString(row.device_authorization_endpoint),
    scopes: parseScopesJson(row.scopes_json),
    client_id: row.client_id,
    client_secret_key: normalizeOptionalString(row.client_secret_key),
    token_endpoint_basic_auth:
      row.token_endpoint_basic_auth === true || row.token_endpoint_basic_auth === 1,
    extra_authorize_params: parseParamsJson(row.extra_authorize_params_json),
    extra_token_params: parseParamsJson(row.extra_token_params_json),
  };
}

export class OAuthProviderRegistry {
  constructor(private readonly db: SqlDb) {}

  async get(input: {
    tenantId: string;
    providerId: string;
  }): Promise<OAuthProviderSpec | undefined> {
    const row = await this.db.get<RawOAuthProviderConfigRow>(
      `SELECT tenant_id, provider_id, display_name, issuer, authorization_endpoint, token_endpoint,
              device_authorization_endpoint, scopes_json, client_id, client_secret_key,
              token_endpoint_basic_auth, extra_authorize_params_json, extra_token_params_json
         FROM oauth_provider_configs
        WHERE tenant_id = ? AND provider_id = ?
        LIMIT 1`,
      [input.tenantId, input.providerId],
    );
    return row ? rowToSpec(row) : undefined;
  }

  async list(input: { tenantId: string }): Promise<OAuthProviderSpec[]> {
    const rows = await this.db.all<RawOAuthProviderConfigRow>(
      `SELECT tenant_id, provider_id, display_name, issuer, authorization_endpoint, token_endpoint,
              device_authorization_endpoint, scopes_json, client_id, client_secret_key,
              token_endpoint_basic_auth, extra_authorize_params_json, extra_token_params_json
         FROM oauth_provider_configs
        WHERE tenant_id = ?
        ORDER BY provider_id ASC`,
      [input.tenantId],
    );
    return rows.map(rowToSpec);
  }
}
