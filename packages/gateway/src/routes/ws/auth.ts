import type { IncomingMessage } from "node:http";
import type { AuthTokenClaims } from "@tyrum/contracts";
import type { AuthTokenService } from "../../app/modules/auth/auth-token-service.js";
import { toSingleHeaderValue } from "../../app/modules/auth/client-ip.js";
import { AUTH_COOKIE_NAME, extractBearerToken } from "../../app/modules/auth/http.js";
import type { NodePairingDal } from "../../app/modules/node/pairing-dal.js";

export const WS_BASE_PROTOCOL = "tyrum-v1";
const WS_AUTH_PROTOCOL_PREFIX = "tyrum-auth.";

export type WsTokenTransport = "authorization" | "cookie" | "subprotocol" | "missing";

export interface WsTokenInfo {
  token: string | undefined;
  transport: WsTokenTransport;
}

export type WsAuthState =
  | { kind: "claims"; claims: AuthTokenClaims }
  | { kind: "scoped_node"; expectedNodeId: string; tenantId: string };

function parseProtocolHeader(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      entry
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    );
  }
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function decodeBase64Url(input: string): string | undefined {
  try {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + "=".repeat(padding);
    const decoded = Buffer.from(padded, "base64").toString("utf-8");
    return decoded.length > 0 ? decoded : undefined;
  } catch (err) {
    void err;
    return undefined;
  }
}

function extractWsTokenFromProtocols(req: IncomingMessage): string | undefined {
  const offered = parseProtocolHeader(req.headers["sec-websocket-protocol"]);
  for (const protocol of offered) {
    if (!protocol.startsWith(WS_AUTH_PROTOCOL_PREFIX)) continue;
    const encodedToken = protocol.slice(WS_AUTH_PROTOCOL_PREFIX.length);
    const decoded = decodeBase64Url(encodedToken);
    if (decoded) return decoded;
  }
  return undefined;
}

function extractCookieValue(
  headerValue: string | string[] | undefined,
  cookieName: string,
): string | undefined {
  if (!headerValue) return undefined;
  const text = Array.isArray(headerValue) ? headerValue.join(";") : headerValue;
  for (const part of text.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const name = trimmed.slice(0, idx).trim();
    if (name !== cookieName) continue;
    const value = trimmed.slice(idx + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

function parseHostHeader(
  value: string,
): { hostname: string; port: string | undefined } | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("[")) {
    const closingIdx = trimmed.indexOf("]");
    if (closingIdx <= 1) return undefined;
    const hostname = trimmed.slice(1, closingIdx);
    const rest = trimmed.slice(closingIdx + 1);
    if (!rest) return { hostname, port: undefined };
    if (!rest.startsWith(":")) return undefined;
    const port = rest.slice(1).trim();
    if (!port) return undefined;
    return { hostname, port };
  }

  const parts = trimmed.split(":");
  if (parts.length === 1) {
    return { hostname: parts[0]!.trim(), port: undefined };
  }
  if (parts.length === 2) {
    const hostname = parts[0]!.trim();
    const port = parts[1]!.trim();
    if (!hostname || !port) return undefined;
    return { hostname, port };
  }
  return undefined;
}

function isSameOriginUpgrade(req: IncomingMessage): boolean {
  const originValue = toSingleHeaderValue(req.headers.origin);
  const hostValue = toSingleHeaderValue(req.headers.host);
  if (!originValue || !hostValue) return false;

  let originUrl: URL;
  try {
    originUrl = new URL(originValue);
  } catch (err) {
    void err;
    return false;
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return false;

  const defaultPort = originUrl.protocol === "https:" ? "443" : "80";
  const originPort = originUrl.port || defaultPort;
  const host = parseHostHeader(hostValue);
  if (!host) return false;
  const hostPort = host.port ?? defaultPort;

  return (
    host.hostname.toLowerCase() === originUrl.hostname.toLowerCase() && hostPort === originPort
  );
}

export function parseRemoteIp(req: IncomingMessage): string | undefined {
  const ip = req.socket.remoteAddress?.trim();
  if (!ip) return undefined;
  return ip;
}

export function parseRequestPath(req: IncomingMessage): string | undefined {
  try {
    return new URL(req.url ?? "/", "http://localhost").pathname;
  } catch (err) {
    void err;
    return undefined;
  }
}

export function extractWsTokenWithTransport(req: IncomingMessage): WsTokenInfo {
  const bearer = extractBearerToken(req.headers.authorization);
  if (bearer) {
    return { token: bearer, transport: "authorization" };
  }

  const cookieToken = extractCookieValue(req.headers.cookie, AUTH_COOKIE_NAME);
  if (cookieToken && isSameOriginUpgrade(req)) {
    return { token: cookieToken, transport: "cookie" };
  }

  const subprotocolToken = extractWsTokenFromProtocols(req);
  if (subprotocolToken) {
    return { token: subprotocolToken, transport: "subprotocol" };
  }

  if (cookieToken) {
    return { token: undefined, transport: "cookie" };
  }

  return { token: undefined, transport: "missing" };
}

export function requestOffersWsBaseSubprotocol(req: IncomingMessage): boolean {
  return parseProtocolHeader(req.headers["sec-websocket-protocol"]).includes(WS_BASE_PROTOCOL);
}

export function selectWsSubprotocol(protocols: Set<string>): string | false {
  if (protocols.has(WS_BASE_PROTOCOL)) return WS_BASE_PROTOCOL;
  return false;
}

export async function resolveWsAuth(input: {
  token: string | undefined;
  authTokens: AuthTokenService;
  nodePairingDal?: NodePairingDal;
}): Promise<WsAuthState | undefined> {
  if (!input.token) return undefined;

  const claims = await input.authTokens.authenticate(input.token).catch(() => null);
  if (claims) {
    // System tokens are HTTP-only (/system/*) and are not valid for WS surfaces.
    if (claims.tenant_id === null) return undefined;
    return { kind: "claims", claims };
  }

  if (!input.nodePairingDal) return undefined;
  const binding = await input.nodePairingDal
    .getScopedTokenBinding(input.token)
    .catch(() => undefined);
  return binding
    ? {
        kind: "scoped_node",
        expectedNodeId: binding.nodeId,
        tenantId: binding.tenantId,
      }
    : undefined;
}
