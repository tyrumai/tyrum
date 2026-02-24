/**
 * Trusted-proxy aware client IP resolution for HTTP requests.
 *
 * Only accepts forwarding headers from an explicit allowlist of proxy IPs.
 * When unset, forwarding headers are treated as untrusted and the client IP
 * is derived from the socket remote address.
 */

import type { Context, Next } from "hono";
import type { IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";

type IpFamily = "ipv4" | "ipv6";

function normalizeIp(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;

  const zoneIndex = trimmed.indexOf("%");
  const withoutZone = zoneIndex === -1 ? trimmed : trimmed.slice(0, zoneIndex);

  const mappedPrefix = "::ffff:";
  if (withoutZone.toLowerCase().startsWith(mappedPrefix)) {
    const maybeIpv4 = withoutZone.slice(mappedPrefix.length);
    if (isIP(maybeIpv4) === 4) {
      return maybeIpv4;
    }
  }

  return withoutZone;
}

function ipFamily(ip: string): IpFamily | undefined {
  const version = isIP(ip);
  if (version === 4) return "ipv4";
  if (version === 6) return "ipv6";
  return undefined;
}

export interface TrustedProxyAllowlist {
  isTrustedProxy(ip: string): boolean;
}

export function createTrustedProxyAllowlistFromEnv(
  raw: string | undefined,
): TrustedProxyAllowlist | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  const entries = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (entries.length === 0) return undefined;

  const allowlist = new BlockList();

  for (const entry of entries) {
    const slashIndex = entry.indexOf("/");
    if (slashIndex !== -1) {
      const baseIp = normalizeIp(entry.slice(0, slashIndex));
      const prefixRaw = entry.slice(slashIndex + 1).trim();
      if (!baseIp) {
        throw new Error(`invalid trusted proxy subnet '${entry}' (missing IP)`);
      }
      const family = ipFamily(baseIp);
      if (!family) {
        throw new Error(`invalid trusted proxy subnet '${entry}' (invalid IP)`);
      }
      if (!/^[0-9]+$/.test(prefixRaw)) {
        throw new Error(`invalid trusted proxy subnet '${entry}' (invalid prefix)`);
      }
      const prefix = Number(prefixRaw);
      if (!Number.isInteger(prefix)) {
        throw new Error(`invalid trusted proxy subnet '${entry}' (invalid prefix)`);
      }
      if (prefix === 0) {
        throw new Error(`invalid trusted proxy subnet '${entry}' (prefix too broad)`);
      }
      const maxPrefix = family === "ipv4" ? 32 : 128;
      if (prefix < 0 || prefix > maxPrefix) {
        throw new Error(`invalid trusted proxy subnet '${entry}' (prefix out of range)`);
      }
      allowlist.addSubnet(baseIp, prefix, family);
      continue;
    }

    const ip = normalizeIp(entry);
    if (!ip) {
      throw new Error(`invalid trusted proxy address '${entry}'`);
    }
    const family = ipFamily(ip);
    if (!family) {
      throw new Error(`invalid trusted proxy address '${entry}'`);
    }
    allowlist.addAddress(ip, family);
  }

  return {
    isTrustedProxy(ip) {
      const normalized = normalizeIp(ip);
      if (!normalized) return false;
      const family = ipFamily(normalized);
      if (!family) return false;
      return allowlist.check(normalized, family);
    },
  };
}

function extractHostFromMaybeAddress(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const withoutQuotes = trimmed.startsWith("\"") && trimmed.endsWith("\"")
    ? trimmed.slice(1, -1).trim()
    : trimmed;

  if (withoutQuotes.startsWith("[")) {
    const closingIdx = withoutQuotes.indexOf("]");
    if (closingIdx <= 1) return undefined;
    const inside = withoutQuotes.slice(1, closingIdx).trim();
    return inside.length > 0 ? inside : undefined;
  }

  const maybeIp = withoutQuotes;
  if (isIP(maybeIp) !== 0) return maybeIp;

  const lastColon = maybeIp.lastIndexOf(":");
  if (lastColon !== -1) {
    const host = maybeIp.slice(0, lastColon).trim();
    const port = maybeIp.slice(lastColon + 1).trim();
    if (/^[0-9]+$/.test(port) && isIP(host) === 4) {
      return host;
    }
  }

  return maybeIp;
}

function splitHeader(value: string, delimiter: "," | ";"): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    if (ch === "\"") {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }

    if (!inQuotes && ch === delimiter) {
      out.push(current);
      current = "";
      continue;
    }

    current += ch;
  }
  out.push(current);
  return out.map((part) => part.trim()).filter((part) => part.length > 0);
}

function parseForwardedHeaderIps(value: string): string[] {
  const ips: string[] = [];
  for (const entry of splitHeader(value, ",")) {
    for (const pair of splitHeader(entry, ";")) {
      const idx = pair.indexOf("=");
      if (idx <= 0) continue;
      const key = pair.slice(0, idx).trim().toLowerCase();
      if (key !== "for") continue;
      const rawFor = pair.slice(idx + 1).trim();
      const host = extractHostFromMaybeAddress(rawFor);
      const normalized = normalizeIp(host);
      if (normalized && ipFamily(normalized)) {
        ips.push(normalized);
        break;
      }
    }
  }
  return ips;
}

function parseXForwardedForHeaderIps(value: string): string[] {
  const ips: string[] = [];
  for (const part of value.split(",")) {
    const host = extractHostFromMaybeAddress(part);
    const normalized = normalizeIp(host);
    if (normalized && ipFamily(normalized)) {
      ips.push(normalized);
    }
  }
  return ips;
}

function parseXRealIpHeaderIps(value: string): string[] {
  const host = extractHostFromMaybeAddress(value);
  const normalized = normalizeIp(host);
  if (normalized && ipFamily(normalized)) {
    return [normalized];
  }
  return [];
}

export function resolveClientIp(input: {
  remoteAddress: string | undefined;
  forwardedHeader: string | undefined;
  xForwardedForHeader: string | undefined;
  xRealIpHeader: string | undefined;
  trustedProxies: TrustedProxyAllowlist | undefined;
}): string | undefined {
  const remoteAddress = normalizeIp(input.remoteAddress);
  if (!remoteAddress) return undefined;
  if (!input.trustedProxies?.isTrustedProxy(remoteAddress)) return remoteAddress;

  const forwardedIps = input.forwardedHeader ? parseForwardedHeaderIps(input.forwardedHeader) : [];
  const xForwardedForIps = input.xForwardedForHeader ? parseXForwardedForHeaderIps(input.xForwardedForHeader) : [];
  const xRealIpIps = input.xRealIpHeader ? parseXRealIpHeaderIps(input.xRealIpHeader) : [];

  const headerIps = forwardedIps.length > 0
    ? forwardedIps
    : xForwardedForIps.length > 0
      ? xForwardedForIps
      : xRealIpIps;

  if (headerIps.length === 0) return remoteAddress;

  // Trust model: only trust forwarding headers when the *direct* peer is a trusted proxy.
  // To mitigate spoofing in X-Forwarded-For chains, compute the client IP by stripping
  // trusted proxies from the right-most end and returning the closest remaining hop.
  const chain = [...headerIps, remoteAddress];
  while (chain.length > 1 && input.trustedProxies.isTrustedProxy(chain[chain.length - 1]!)) {
    chain.pop();
  }

  return chain[chain.length - 1] ?? remoteAddress;
}

function resolveSocketRemoteAddress(c: Context): string | undefined {
  const incoming = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming;
  return normalizeIp(incoming?.socket?.remoteAddress);
}

export function createClientIpMiddleware(opts: {
  trustedProxies?: TrustedProxyAllowlist;
} = {}): (c: Context, next: Next) => Promise<void> {
  return async (c, next) => {
    const clientIp = resolveClientIp({
      remoteAddress: resolveSocketRemoteAddress(c),
      forwardedHeader: c.req.header("forwarded") ?? undefined,
      xForwardedForHeader: c.req.header("x-forwarded-for") ?? undefined,
      xRealIpHeader: c.req.header("x-real-ip") ?? undefined,
      trustedProxies: opts.trustedProxies,
    });

    c.set("clientIp", clientIp);
    await next();
  };
}

export function getClientIp(c: Context): string | undefined {
  try {
    const value = c.get("clientIp");
    if (typeof value !== "string") return undefined;
    return normalizeIp(value);
  } catch {
    return undefined;
  }
}
