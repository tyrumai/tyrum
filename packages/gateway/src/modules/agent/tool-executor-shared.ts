import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import type { SqlDb } from "../../statestore/types.js";
import type { TaggedContent } from "./provenance.js";

export const MAX_RESPONSE_BYTES = 32_768;
export const TRUNCATION_MARKER = "...(truncated)";
export const HTTP_TIMEOUT_MS = 30_000;
export const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
export const MAX_EXEC_TIMEOUT_MS = 300_000;
export const DEFAULT_NODE_DISPATCH_TIMEOUT_MS = 30_000;
export const MAX_NODE_DISPATCH_TIMEOUT_MS = 300_000;

const ENV_DENY_PREFIXES: readonly string[] = ["TYRUM_", "GATEWAY_"];
const ENV_DENY_NAMES: ReadonlySet<string> = new Set(["TELEGRAM_BOT_TOKEN"]);
const BLOCKED_HTTP_HOSTS = new Set(["localhost", "metadata.google.internal"]);

export interface ToolResult {
  tool_call_id: string;
  output: string;
  error?: string;
  provenance?: TaggedContent;
  meta?: ToolResultMeta;
}

export type ToolResultMeta = {
  kind: "fs.read";
  path: string;
  offset?: number;
  limit?: number;
  raw_chars: number;
  selected_chars: number;
  truncated: boolean;
  truncation_marker?: string;
} | {
  kind: "memory.seed";
  keyword_hit_count: number;
  semantic_hit_count: number;
  structured_item_count: number;
  included_item_ids: string[];
};

export type WorkspaceLeaseConfig = {
  db: SqlDb;
  tenantId: string;
  agentId: string | null;
  workspaceId: string;
  ownerPrefix?: string;
};

export type ToolExecutionAudit = {
  agent_id?: string;
  workspace_id?: string;
  session_id?: string;
  channel?: string;
  thread_id?: string;
  work_session_key?: string;
  work_lane?: string;
  execution_run_id?: string;
  execution_step_id?: string;
  policy_snapshot_id?: string;
};

export type DnsLookupFn = (hostname: string) => Promise<readonly LookupAddress[]>;

async function defaultDnsLookup(hostname: string): Promise<readonly LookupAddress[]> {
  return lookup(hostname, {
    all: true,
    verbatim: true,
  });
}

export const DEFAULT_DNS_LOOKUP: DnsLookupFn = defaultDnsLookup;

export function sanitizeEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  extraDenyPrefixes: readonly string[] = [],
  extraDenyNames: ReadonlySet<string> = new Set(),
): Record<string, string> {
  const denyPrefixes = [...ENV_DENY_PREFIXES, ...extraDenyPrefixes];
  const denyNames = new Set([...ENV_DENY_NAMES, ...extraDenyNames]);
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (denyNames.has(key)) continue;
    if (denyPrefixes.some((prefix) => key.startsWith(prefix))) continue;
    result[key] = value;
  }

  return result;
}

function parseNumericIPv4(hostname: string): [number, number, number, number] | null {
  if (/^\d+$/.test(hostname)) {
    const n = Number(hostname);
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }

  if (/^0x[0-9a-fA-F]+$/i.test(hostname)) {
    const n = Number(hostname);
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }

  const octets = hostname.split(".");
  if (octets.length === 4 && octets.some((octet) => /^0\d/.test(octet))) {
    const parsed = octets.map((octet) => {
      if (/^0[0-7]+$/.test(octet)) return parseInt(octet, 8);
      if (/^\d+$/.test(octet)) return Number(octet);
      return NaN;
    });
    if (parsed.every((value) => Number.isFinite(value) && value >= 0 && value <= 255)) {
      return parsed as [number, number, number, number];
    }
  }

  return null;
}

function isPrivateIPv4(a: number, b: number, _c: number, _d: number): boolean {
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

function isBlockedIPv6(hostname: string): boolean {
  const raw = hostname.toLowerCase();
  if (raw === "::1" || raw === "::") return true;
  if (/^fe[89ab][0-9a-f]?:/i.test(raw)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(raw)) return true;
  if (raw === "fc00::" || raw === "fd00::") return true;

  const v4dotted = raw.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4dotted) {
    const [, sa, sb, sc, sd] = v4dotted;
    if (isPrivateIPv4(Number(sa), Number(sb), Number(sc), Number(sd))) return true;
  }

  const v4hex = raw.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4hex) {
    const hi = parseInt(v4hex[1]!, 16);
    const lo = parseInt(v4hex[2]!, 16);
    const a = (hi >>> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >>> 8) & 0xff;
    const d = lo & 0xff;
    if (isPrivateIPv4(a, b, c, d)) return true;
  }

  return false;
}

function isBlockedIpLiteral(hostname: string): boolean {
  const version = isIP(hostname);
  if (version === 4) {
    const parts = hostname.split(".");
    if (parts.length !== 4 || !parts.every((part) => /^\d+$/.test(part))) return false;
    const [a, b, c, d] = parts.map(Number) as [number, number, number, number];
    return isPrivateIPv4(a, b, c, d);
  }

  if (version === 6) {
    return isBlockedIPv6(hostname);
  }

  return false;
}

export function isBlockedUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return true;
    }

    const { hostname } = parsed;
    if (BLOCKED_HTTP_HOSTS.has(hostname)) return true;

    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      return isBlockedIPv6(hostname.slice(1, -1));
    }

    const dotParts = hostname.split(".");
    if (dotParts.length === 4 && dotParts.every((part) => /^\d+$/.test(part))) {
      const [a, b, c, d] = dotParts.map(Number) as [number, number, number, number];
      if (isPrivateIPv4(a, b, c, d)) return true;
    }

    const numeric = parseNumericIPv4(hostname);
    return numeric ? isPrivateIPv4(...numeric) : false;
  } catch {
    // Intentional: invalid or non-http URLs are blocked by default.
    return true;
  }
}

export async function resolvesToBlockedAddress(
  raw: string,
  dnsLookup: DnsLookupFn = DEFAULT_DNS_LOOKUP,
): Promise<boolean> {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return true;
    }

    const { hostname } = parsed;
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      return isBlockedIpLiteral(hostname.slice(1, -1));
    }
    if (isBlockedIpLiteral(hostname)) {
      return true;
    }
    if (isIP(hostname) !== 0) {
      return false;
    }

    const resolved = await dnsLookup(hostname);
    if (resolved.length === 0) {
      return true;
    }

    return resolved.some((entry) => isBlockedIpLiteral(entry.address));
  } catch {
    // Intentional: resolver failures are treated as blocked destinations.
    return true;
  }
}
