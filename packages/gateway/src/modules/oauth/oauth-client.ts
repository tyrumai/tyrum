import type { OAuthProviderSpec } from "./provider-registry.js";
import { coerceString } from "../util/coerce.js";

export interface ResolvedOAuthEndpoints {
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  deviceAuthorizationEndpoint?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  [key: string]: unknown;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function resolveTimeoutMs(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs) || !timeoutMs || timeoutMs <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.floor(timeoutMs));
}

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/$/, "");
}

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `oauth discovery failed (${String(res.status)}): ${text.slice(0, 300)}`,
      );
    }
    return JSON.parse(text) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveOAuthEndpoints(
  spec: OAuthProviderSpec,
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number; requireDeviceAuthorizationEndpoint?: boolean },
): Promise<ResolvedOAuthEndpoints> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const timeoutMs = resolveTimeoutMs(opts?.timeoutMs);
  const requireDeviceAuthorizationEndpoint = opts?.requireDeviceAuthorizationEndpoint ?? false;

  const explicit: ResolvedOAuthEndpoints = {
    authorizationEndpoint: spec.authorization_endpoint,
    tokenEndpoint: spec.token_endpoint,
    deviceAuthorizationEndpoint: spec.device_authorization_endpoint,
  };

  const needsDiscovery = Boolean(
    spec.issuer &&
      (!explicit.authorizationEndpoint ||
        !explicit.tokenEndpoint ||
        (requireDeviceAuthorizationEndpoint && !explicit.deviceAuthorizationEndpoint)),
  );
  if (!needsDiscovery) return explicit;

  const issuer = normalizeUrl(spec.issuer!);
  const wellKnown = `${issuer}/.well-known/openid-configuration`;
  const json = await fetchJson(wellKnown, fetchImpl, timeoutMs);

  const authorizationEndpoint =
    explicit.authorizationEndpoint ??
    (typeof json["authorization_endpoint"] === "string" ? String(json["authorization_endpoint"]) : undefined);
  const tokenEndpoint =
    explicit.tokenEndpoint ??
    (typeof json["token_endpoint"] === "string" ? String(json["token_endpoint"]) : undefined);
  const deviceAuthorizationEndpoint =
    explicit.deviceAuthorizationEndpoint ??
    (typeof json["device_authorization_endpoint"] === "string" ? String(json["device_authorization_endpoint"]) : undefined);

  return {
    authorizationEndpoint,
    tokenEndpoint,
    deviceAuthorizationEndpoint,
  };
}

function parseTokenResponseBody(input: { text: string; contentType: string | null }): Record<string, unknown> {
  const trimmed = input.text.trim();
  if (!trimmed) return {};

  const contentType = input.contentType?.toLowerCase() ?? "";

  if (contentType.includes("application/json") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  // Some providers (e.g. GitHub) may return application/x-www-form-urlencoded.
  const params = new URLSearchParams(trimmed);
  const out: Record<string, unknown> = {};
  for (const [k, v] of params.entries()) {
    out[k] = v;
  }
  return out;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

async function postTokenForm(
  tokenEndpoint: string,
  params: Record<string, string>,
  opts: {
    fetchImpl: typeof fetch;
    timeoutMs: number;
    tokenEndpointBasicAuth: boolean;
    clientId: string;
    clientSecret?: string;
  },
): Promise<OAuthTokenResponse> {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };

  if (opts.tokenEndpointBasicAuth) {
    if (!opts.clientSecret) {
      throw new Error("oauth token endpoint requires client_secret for basic auth");
    }
    const credential = Buffer.from(`${opts.clientId}:${opts.clientSecret}`, "utf-8").toString("base64");
    headers["authorization"] = `Basic ${credential}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const res = await opts.fetchImpl(tokenEndpoint, {
      method: "POST",
      headers,
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
    });

    const text = await res.text().catch(() => "");
    const body = parseTokenResponseBody({ text, contentType: res.headers.get("content-type") });

    if (!res.ok) {
      const maybeError =
        coerceString(body["error"]) ??
        coerceString(body["error_description"]) ??
        coerceString(body["message"]);
      const suffix = maybeError ? `: ${maybeError}` : "";
      throw new Error(`oauth token exchange failed (${String(res.status)})${suffix}`);
    }

    const accessToken = coerceString(body["access_token"]);
    if (!accessToken) {
      throw new Error("oauth token exchange did not return access_token");
    }

    const out: OAuthTokenResponse = {
      ...body,
      access_token: accessToken,
      token_type: coerceString(body["token_type"]),
      refresh_token: coerceString(body["refresh_token"]),
      expires_in: coerceNumber(body["expires_in"]),
      scope: coerceString(body["scope"]),
      id_token: coerceString(body["id_token"]),
    };

    return out;
  } finally {
    clearTimeout(timer);
  }
}

export async function exchangeAuthorizationCode(input: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpointBasicAuth: boolean;
  code: string;
  redirectUri: string;
  pkceVerifier: string;
  scope?: string;
  extraParams?: Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<OAuthTokenResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = resolveTimeoutMs(input.timeoutMs);

  const params: Record<string, string> = {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.pkceVerifier,
  };
  if (!input.tokenEndpointBasicAuth) {
    params["client_id"] = input.clientId;
  }
  if (!input.tokenEndpointBasicAuth && input.clientSecret) {
    params["client_secret"] = input.clientSecret;
  }
  if (input.scope) {
    params["scope"] = input.scope;
  }
  if (input.extraParams) {
    Object.assign(params, input.extraParams);
  }

  return await postTokenForm(input.tokenEndpoint, params, {
    fetchImpl,
    timeoutMs,
    tokenEndpointBasicAuth: input.tokenEndpointBasicAuth,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
  });
}

export async function refreshAccessToken(input: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpointBasicAuth: boolean;
  refreshToken: string;
  scope?: string;
  extraParams?: Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<OAuthTokenResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = resolveTimeoutMs(input.timeoutMs);

  const params: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  };
  if (!input.tokenEndpointBasicAuth) {
    params["client_id"] = input.clientId;
  }
  if (!input.tokenEndpointBasicAuth && input.clientSecret) {
    params["client_secret"] = input.clientSecret;
  }
  if (input.scope) {
    params["scope"] = input.scope;
  }
  if (input.extraParams) {
    Object.assign(params, input.extraParams);
  }

  return await postTokenForm(input.tokenEndpoint, params, {
    fetchImpl,
    timeoutMs,
    tokenEndpointBasicAuth: input.tokenEndpointBasicAuth,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
  });
}
