import { join } from "node:path";

import { normalizeFingerprint256 } from "@tyrum/operator-core";

export type GatewayUrls = {
  wsUrl: string;
  httpBaseUrl: string;
};

export type ResolvedTuiConfig = GatewayUrls & {
  token: string;
  deviceIdentityPath: string;
  tlsCertFingerprint256?: string;
  tlsAllowSelfSigned: boolean;
  reconnect: boolean;
};

function hasScheme(raw: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw);
}

export function resolveGatewayUrls(rawGatewayUrl: string): GatewayUrls {
  const trimmed = rawGatewayUrl.trim();
  if (!trimmed) {
    throw new Error("Gateway URL is required.");
  }

  const normalized = hasScheme(trimmed) ? trimmed : `http://${trimmed}`;

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("Invalid gateway URL; expected an absolute URL or host:port.");
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";
    return {
      httpBaseUrl: url.origin,
      wsUrl: `${wsProtocol}//${url.host}/ws`,
    };
  }

  if (url.protocol === "ws:" || url.protocol === "wss:") {
    const httpProtocol = url.protocol === "wss:" ? "https:" : "http:";
    const pathname = url.pathname === "/" || url.pathname === "" ? "/ws" : url.pathname;
    return {
      httpBaseUrl: `${httpProtocol}//${url.host}`,
      wsUrl: `${url.protocol}//${url.host}${pathname}`,
    };
  }

  throw new Error("Invalid gateway URL; expected http(s):// or ws(s)://.");
}

export function resolveTuiConfig(input: {
  env: Record<string, string | undefined>;
  defaults: { gatewayUrl: string; tyrumHome: string };
  gatewayUrl?: string;
  token?: string;
  tyrumHome?: string;
  deviceIdentityPath?: string;
  tlsCertFingerprint256?: string;
  tlsAllowSelfSigned?: boolean;
  reconnect?: boolean;
}): ResolvedTuiConfig {
  const gatewayUrl = (input.gatewayUrl ?? "").trim() || input.defaults.gatewayUrl;
  const urls = resolveGatewayUrls(gatewayUrl);

  const token = (input.token ?? "").trim() || (input.env["GATEWAY_TOKEN"] ?? "").trim();
  if (!token) {
    throw new Error("Gateway token is required (set --token or GATEWAY_TOKEN).");
  }

  const tyrumHome =
    (input.tyrumHome ?? "").trim() ||
    (input.env["TYRUM_HOME"] ?? "").trim() ||
    input.defaults.tyrumHome;

  const deviceIdentityPath =
    (input.deviceIdentityPath ?? "").trim() || join(tyrumHome, "tui", "device-identity.json");

  const tlsCertFingerprint256Raw = (input.tlsCertFingerprint256 ?? "").trim();
  const tlsCertFingerprint256 = (() => {
    if (!tlsCertFingerprint256Raw) return undefined;
    const normalized = normalizeFingerprint256(tlsCertFingerprint256Raw);
    if (!normalized) {
      throw new Error(
        "Invalid tls fingerprint256; expected 64 hex characters (with optional ':').",
      );
    }
    return normalized;
  })();

  const tlsAllowSelfSigned = Boolean(input.tlsAllowSelfSigned);
  if (tlsAllowSelfSigned && !tlsCertFingerprint256) {
    throw new Error("--tls-allow-self-signed requires --tls-fingerprint256.");
  }

  return {
    ...urls,
    token,
    deviceIdentityPath,
    tlsCertFingerprint256,
    tlsAllowSelfSigned,
    reconnect: input.reconnect ?? true,
  };
}
