import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface OAuthProviderSpec {
  provider_id: string;
  display_name?: string;
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  device_authorization_endpoint?: string;
  scopes: string[];
  client_id_env?: string;
  client_secret_env?: string;
  token_endpoint_basic_auth: boolean;
  extra_authorize_params?: Record<string, string>;
  extra_token_params?: Record<string, string>;
}

export interface OAuthProviderConfigFile {
  providers: OAuthProviderSpec[];
}

function coerceRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function coerceString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(coerceString).filter((v): v is string => Boolean(v));
}

function coerceStringRecord(value: unknown): Record<string, string> | undefined {
  const record = coerceRecord(value);
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(record)) {
    const k = coerceString(key);
    const vv = coerceString(v);
    if (k && vv) out[k] = vv;
  }
  return out;
}

function parseOAuthProviderSpec(value: unknown): OAuthProviderSpec {
  const record = coerceRecord(value);
  if (!record) {
    throw new Error("oauth provider spec must be an object");
  }

  const providerId = coerceString(record["provider_id"]);
  if (!providerId) {
    throw new Error("oauth provider spec missing provider_id");
  }

  const tokenEndpointBasicAuthRaw = record["token_endpoint_basic_auth"];
  const tokenEndpointBasicAuth =
    typeof tokenEndpointBasicAuthRaw === "boolean" ? tokenEndpointBasicAuthRaw : true;

  return {
    provider_id: providerId,
    display_name: coerceString(record["display_name"]),
    issuer: coerceString(record["issuer"]),
    authorization_endpoint: coerceString(record["authorization_endpoint"]),
    token_endpoint: coerceString(record["token_endpoint"]),
    device_authorization_endpoint: coerceString(record["device_authorization_endpoint"]),
    scopes: coerceStringArray(record["scopes"]),
    client_id_env: coerceString(record["client_id_env"]),
    client_secret_env: coerceString(record["client_secret_env"]),
    token_endpoint_basic_auth: tokenEndpointBasicAuth,
    extra_authorize_params: coerceStringRecord(record["extra_authorize_params"]),
    extra_token_params: coerceStringRecord(record["extra_token_params"]),
  };
}

function parseOAuthProviderConfigFile(value: unknown): OAuthProviderConfigFile {
  const record = coerceRecord(value) ?? {};
  const providersRaw = record["providers"];
  const providers: OAuthProviderSpec[] = [];
  if (Array.isArray(providersRaw)) {
    for (const entry of providersRaw) {
      providers.push(parseOAuthProviderSpec(entry));
    }
  }
  return { providers };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveDefaultConfigPath(): string | undefined {
  const fromEnv = process.env["TYRUM_OAUTH_PROVIDERS_CONFIG"]?.trim();
  if (fromEnv) return fromEnv;

  const home = process.env["TYRUM_HOME"]?.trim();
  if (home) return join(home, "oauth-providers.yml");

  return join(process.cwd(), "config", "oauth_providers.yml");
}

export class OAuthProviderRegistry {
  private cached: Map<string, OAuthProviderSpec> | undefined;
  private cachedAtMs = 0;

  constructor(private readonly opts?: { ttlMs?: number; configPath?: string }) {}

  async get(providerId: string): Promise<OAuthProviderSpec | undefined> {
    const specs = await this.load();
    return specs.get(providerId);
  }

  async list(): Promise<OAuthProviderSpec[]> {
    return [...(await this.load()).values()];
  }

  async reload(): Promise<void> {
    this.cached = undefined;
    this.cachedAtMs = 0;
    await this.load();
  }

  private async load(): Promise<Map<string, OAuthProviderSpec>> {
    const ttlMs = this.opts?.ttlMs ?? 30_000;
    const now = Date.now();
    if (this.cached && now - this.cachedAtMs < ttlMs) return this.cached;

    const path = this.opts?.configPath ?? resolveDefaultConfigPath();
    const byId = new Map<string, OAuthProviderSpec>();

    if (path && (await fileExists(path))) {
      const raw = await readFile(path, "utf-8");
      const parsed = parseYaml(raw) as unknown;
      const cfg = parseOAuthProviderConfigFile(parsed ?? {});
      for (const spec of cfg.providers) {
        byId.set(spec.provider_id, spec);
      }
    }

    this.cached = byId;
    this.cachedAtMs = now;
    return byId;
  }
}
