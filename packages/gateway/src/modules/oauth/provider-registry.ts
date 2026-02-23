import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { coerceNonEmptyStringRecord, coerceRecord, coerceString } from "../util/coerce.js";

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

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(coerceString).filter((v): v is string => Boolean(v));
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

  const clientSecretEnv = coerceString(record["client_secret_env"]);

  const tokenEndpointBasicAuthRaw = record["token_endpoint_basic_auth"];
  const tokenEndpointBasicAuth =
    typeof tokenEndpointBasicAuthRaw === "boolean"
      ? tokenEndpointBasicAuthRaw
      : Boolean(clientSecretEnv);

  if (tokenEndpointBasicAuth && !clientSecretEnv) {
    throw new Error(
      "oauth provider spec missing client_secret_env (required when token_endpoint_basic_auth=true)",
    );
  }

  return {
    provider_id: providerId,
    display_name: coerceString(record["display_name"]),
    issuer: coerceString(record["issuer"]),
    authorization_endpoint: coerceString(record["authorization_endpoint"]),
    token_endpoint: coerceString(record["token_endpoint"]),
    device_authorization_endpoint: coerceString(record["device_authorization_endpoint"]),
    scopes: coerceStringArray(record["scopes"]),
    client_id_env: coerceString(record["client_id_env"]),
    client_secret_env: clientSecretEnv,
    token_endpoint_basic_auth: tokenEndpointBasicAuth,
    extra_authorize_params: coerceNonEmptyStringRecord(record["extra_authorize_params"]),
    extra_token_params: coerceNonEmptyStringRecord(record["extra_token_params"]),
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

function resolveDefaultConfigPaths(): string[] {
  const fromEnv = process.env["TYRUM_OAUTH_PROVIDERS_CONFIG"]?.trim();
  if (fromEnv) return [fromEnv];

  const home = process.env["TYRUM_HOME"]?.trim();
  if (home) {
    return [join(home, "oauth-providers.yml"), join(home, "oauth_providers.yml")];
  }

  const configDir = join(process.cwd(), "config");
  return [join(configDir, "oauth-providers.yml"), join(configDir, "oauth_providers.yml")];
}

export class OAuthProviderRegistry {
  private cached: Map<string, OAuthProviderSpec> | undefined;
  private cachedAtMs = 0;

  constructor(private readonly opts?: { ttlMs?: number; configPath?: string; configPaths?: string[] }) {}

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

    const fromEnv = process.env["TYRUM_OAUTH_PROVIDERS_CONFIG"]?.trim();
    const paths = fromEnv
      ? [fromEnv]
      : this.opts?.configPaths && this.opts.configPaths.length > 0
        ? this.opts.configPaths
        : this.opts?.configPath
          ? [this.opts.configPath]
          : resolveDefaultConfigPaths();
    const byId = new Map<string, OAuthProviderSpec>();

    for (const path of paths) {
      if (!path) continue;
      if (!(await fileExists(path))) continue;

      const raw = await readFile(path, "utf-8");
      const parsed = parseYaml(raw) as unknown;
      const cfg = parseOAuthProviderConfigFile(parsed ?? {});
      for (const spec of cfg.providers) {
        byId.set(spec.provider_id, spec);
      }
      break;
    }

    this.cached = byId;
    this.cachedAtMs = now;
    return byId;
  }
}
