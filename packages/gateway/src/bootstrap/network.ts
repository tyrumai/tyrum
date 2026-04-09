import { isIP } from "node:net";

const LOOPBACK_HOSTNAMES = new Set(["localhost"]);

export type GatewayRole = "all" | "edge" | "worker" | "scheduler" | "desktop-runtime";
export type NonLoopbackTransportPolicy = "local" | "tls" | "insecure";

function normalizeHostForLoopbackCheck(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHostForLoopbackCheck(host).toLowerCase();
  if (LOOPBACK_HOSTNAMES.has(normalized)) return true;

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return normalized.startsWith("127.");
  }
  if (ipVersion === 6) {
    return normalized === "::1" || normalized === "0:0:0:0:0:0:0:1";
  }
  return false;
}

export function splitHostAndPort(rawHost: string): { host: string; port: string | null } {
  const trimmed = rawHost.trim();
  if (trimmed.length === 0) {
    return { host: "", port: null };
  }

  if (trimmed.startsWith("[")) {
    const closeBracket = trimmed.indexOf("]");
    if (closeBracket !== -1) {
      const host = trimmed.slice(1, closeBracket);
      const rest = trimmed.slice(closeBracket + 1);
      if (rest.startsWith(":")) {
        const port = rest.slice(1);
        if (/^[0-9]+$/.test(port)) {
          return { host, port };
        }
      }
      return { host, port: null };
    }
  }

  const firstColon = trimmed.indexOf(":");
  const lastColon = trimmed.lastIndexOf(":");
  if (firstColon !== -1 && firstColon === lastColon) {
    const host = trimmed.slice(0, lastColon);
    const port = trimmed.slice(lastColon + 1);
    if (host.length > 0 && /^[0-9]+$/.test(port)) {
      return { host, port };
    }
  }

  if (firstColon !== -1 && firstColon !== lastColon) {
    const host = trimmed.slice(0, lastColon);
    const port = trimmed.slice(lastColon + 1);
    if (host.length > 0 && /^[0-9]+$/.test(port) && isIP(host) === 6) {
      return { host, port };
    }
  }

  return { host: trimmed, port: null };
}

export function assertNonLoopbackDeploymentGuardrails(input: {
  role: GatewayRole;
  host: string;
  tlsReady?: boolean;
  allowInsecureHttp?: boolean;
  hasTenantAdminToken?: boolean;
}): NonLoopbackTransportPolicy {
  const shouldRunEdge = input.role === "all" || input.role === "edge";
  if (!shouldRunEdge) return "local";

  const hostSplit = splitHostAndPort(input.host);
  const hostForLoopback = hostSplit.host.length > 0 ? hostSplit.host : input.host;
  const isLocalOnly = isLoopbackHost(hostForLoopback);
  if (isLocalOnly) return "local";

  if (input.hasTenantAdminToken === false) {
    throw new Error(
      "Gateway is configured to bind to a non-loopback address but no tenant admin tokens exist. " +
        "Create a tenant admin token before exposing the gateway beyond loopback.",
    );
  }

  const tlsReady = input.tlsReady ?? false;
  if (tlsReady) return "tls";

  const allowInsecureHttp = input.allowInsecureHttp ?? false;
  if (allowInsecureHttp) return "insecure";

  throw new Error(
    "Gateway is configured to bind to a non-loopback address. Remote operation requires TLS. " +
      "Configure TLS termination and set deployment config server.tlsReady=true (recommended), " +
      "or set deployment config server.allowInsecureHttp=true to acknowledge and allow plaintext HTTP in a trusted network.",
  );
}

export function isLoopbackOnlyHost(host: string): boolean {
  return isLoopbackHost(host);
}
