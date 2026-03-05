import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { ActionPrimitiveKind, CapabilityDescriptor } from "@tyrum/schemas";
import {
  descriptorIdForClientCapability,
  requiredCapability,
  type ActionPrimitive,
  type McpServerSpec as McpServerSpecT,
} from "@tyrum/schemas";
import type { McpManager } from "./mcp-manager.js";
import type { TaggedContent } from "./provenance.js";
import { tagContent } from "./provenance.js";
import { sanitizeForModel } from "./sanitizer.js";
import type { NodeDispatchService } from "./node-dispatch-service.js";
import type { SecretProvider } from "../secret/provider.js";
import type { SecretResolutionAuditDal } from "../secret/resolution-audit-dal.js";
import type { RedactionEngine } from "../redaction/engine.js";
import type { SqlDb } from "../../statestore/types.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";
import { acquireWorkspaceLease, releaseWorkspaceLease } from "../workspace/lease.js";
import type { ArtifactStore } from "../artifact/store.js";
import {
  NoCapableNodeError,
  NodeDispatchDeniedError,
  NodeNotPairedError,
} from "../../ws/protocol/errors.js";
import {
  resolveDesktopEvidenceSensitivity,
  shapeDesktopEvidenceForArtifacts,
} from "../desktop/shape-desktop-evidence.js";
import {
  resolveBrowserEvidenceSensitivity,
  shapeBrowserEvidenceForArtifacts,
} from "../browser/shape-browser-evidence.js";

const MAX_RESPONSE_BYTES = 32_768;
const TRUNCATION_MARKER = "...(truncated)";
const HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
const MAX_EXEC_TIMEOUT_MS = 300_000;
const DEFAULT_NODE_DISPATCH_TIMEOUT_MS = 30_000;
const MAX_NODE_DISPATCH_TIMEOUT_MS = 300_000;

/** Sentinel prefix for secret handle references in tool arguments. */
const SECRET_HANDLE_PREFIX = "secret:";

/* ------------------------------------------------------------------ */
/*  Environment sanitisation for child processes                       */
/* ------------------------------------------------------------------ */

const ENV_DENY_PREFIXES: readonly string[] = ["TYRUM_", "GATEWAY_"];
const ENV_DENY_NAMES: ReadonlySet<string> = new Set(["TELEGRAM_BOT_TOKEN"]);

/**
 * Build a sanitised copy of the process environment by stripping keys that
 * match a denylist of prefixes or exact names.  Designed for spawning child
 * processes that must not inherit gateway secrets.
 */
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

/* ------------------------------------------------------------------ */
/*  SSRF blocklist helpers                                             */
/* ------------------------------------------------------------------ */

const BLOCKED_HTTP_HOSTS = new Set(["localhost", "metadata.google.internal"]);

type DnsLookupFn = (hostname: string) => Promise<readonly LookupAddress[]>;

async function defaultDnsLookup(hostname: string): Promise<readonly LookupAddress[]> {
  return lookup(hostname, {
    all: true,
    verbatim: true,
  });
}

/**
 * Parse a hostname that encodes an IPv4 address as a single decimal integer,
 * a hex literal, or dot-separated octets that use octal notation.
 *
 * Returns a 4-tuple `[a, b, c, d]` or `null` if the hostname is not a
 * numeric IPv4 representation.
 */
function parseNumericIPv4(hostname: string): [number, number, number, number] | null {
  // Single decimal integer: "2130706433" → 127.0.0.1
  if (/^\d+$/.test(hostname)) {
    const n = Number(hostname);
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }

  // Hex integer: "0x7f000001" → 127.0.0.1
  if (/^0x[0-9a-fA-F]+$/i.test(hostname)) {
    const n = Number(hostname);
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }

  // Octal per-octet: "0177.0.0.1" → 127.0.0.1
  // Accept dotted-quad where any octet starts with "0" (octal prefix).
  const octets = hostname.split(".");
  if (octets.length === 4 && octets.some((o) => /^0\d/.test(o))) {
    const parsed = octets.map((o) => {
      if (/^0[0-7]+$/.test(o)) return parseInt(o, 8); // octal
      if (/^\d+$/.test(o)) return Number(o); // decimal
      return NaN;
    });
    if (parsed.every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) {
      return parsed as [number, number, number, number];
    }
  }

  return null;
}

/** Check whether an IPv4 address falls in a private / reserved range. */
function isPrivateIPv4(a: number, b: number, _c: number, _d: number): boolean {
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8
  if (a === 0) return true;
  return false;
}

/** Check whether a hostname is a blocked IPv6 address. */
function isBlockedIPv6(hostname: string): boolean {
  const raw = hostname.toLowerCase();

  // Loopback ::1
  if (raw === "::1") return true;
  // Unspecified ::
  if (raw === "::") return true;

  // Link-local fe80::/10  (fe80 – febf)
  if (/^fe[89ab][0-9a-f]?:/i.test(raw)) return true;

  // Unique-local fc00::/7  (fc00 – fdff)
  if (/^f[cd][0-9a-f]{2}:/i.test(raw)) return true;
  if (raw === "fc00::" || raw === "fd00::") return true;

  // IPv4-mapped — dotted-decimal form ::ffff:x.x.x.x
  const v4dotted = raw.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4dotted) {
    const [, sa, sb, sc, sd] = v4dotted;
    if (isPrivateIPv4(Number(sa), Number(sb), Number(sc), Number(sd))) return true;
  }

  // IPv4-mapped — hex-normalised form ::ffff:HHHH:HHHH
  // Node's URL parser normalises e.g. ::ffff:127.0.0.1 → ::ffff:7f00:1
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
    if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
      const [a, b, c, d] = parts.map(Number) as [number, number, number, number];
      return isPrivateIPv4(a, b, c, d);
    }
    return false;
  }

  if (version === 6) {
    return isBlockedIPv6(hostname);
  }

  return false;
}

/**
 * Determine whether a URL targets a private, loopback, link-local, or
 * otherwise reserved network address.  Used by `tool.http.fetch` to
 * prevent server-side request forgery (SSRF).
 */
export function isBlockedUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return true;
    }
    const hostname = parsed.hostname;

    // Exact-match denylist (localhost, cloud metadata hostnames)
    if (BLOCKED_HTTP_HOSTS.has(hostname)) return true;

    // IPv6 literals: Node's URL keeps brackets, e.g. "[::1]" → "[::1]"
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      const bare = hostname.slice(1, -1);
      return isBlockedIPv6(bare);
    }

    // Standard dotted-quad IPv4
    const dotParts = hostname.split(".");
    if (dotParts.length === 4 && dotParts.every((p) => /^\d+$/.test(p))) {
      const [a, b, c, d] = dotParts.map(Number) as [number, number, number, number];
      if (isPrivateIPv4(a, b, c, d)) return true;
    }

    // Numeric IPv4 evasion (decimal integer, hex, octal)
    const numeric = parseNumericIPv4(hostname);
    if (numeric && isPrivateIPv4(...numeric)) return true;

    return false;
  } catch {
    // Intentional: invalid URL parsing → block (SSRF safe default).
    return true; // invalid URL → block
  }
}

/**
 * Resolve non-literal hostnames and block if any resolved address is
 * private/link-local/loopback/reserved.
 */
export async function resolvesToBlockedAddress(
  raw: string,
  dnsLookup: DnsLookupFn = defaultDnsLookup,
): Promise<boolean> {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return true;
    }

    const hostname = parsed.hostname;
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

    for (const entry of resolved) {
      if (isBlockedIpLiteral(entry.address)) {
        return true;
      }
    }

    return false;
  } catch {
    // Intentional: URL parse/DNS errors → treat as blocked (SSRF safe default).
    return true;
  }
}

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
};

type WorkspaceLeaseConfig = {
  db: SqlDb;
  tenantId: string;
  workspaceId: string;
  ownerPrefix?: string;
};

export class ToolExecutor {
  constructor(
    private readonly home: string,
    private readonly mcpManager: McpManager,
    private readonly mcpServerSpecs: ReadonlyMap<string, McpServerSpecT>,
    private readonly fetchImpl: typeof fetch,
    private readonly secretProvider?: SecretProvider,
    private readonly dnsLookup: DnsLookupFn = defaultDnsLookup,
    private readonly redactionEngine?: RedactionEngine,
    private readonly secretResolutionAuditDal?: SecretResolutionAuditDal,
    private readonly workspaceLease?: WorkspaceLeaseConfig,
    private readonly nodeDispatchService?: NodeDispatchService,
    private readonly artifactStore?: ArtifactStore,
  ) {}

  private workspaceLeaseOwner(toolCallId: string): string {
    const prefix = this.workspaceLease?.ownerPrefix?.trim() ?? "tool-executor";
    return `${prefix}:${toolCallId}`;
  }

  private async withWorkspaceLease<T>(
    toolCallId: string,
    opts: { ttlMs: number; waitMs: number },
    fn: (ctx: { waitedMs: number }) => Promise<T>,
  ): Promise<T> {
    const lease = this.workspaceLease;
    if (!lease) return await fn({ waitedMs: 0 });

    const owner = this.workspaceLeaseOwner(toolCallId);
    const startedAtMs = Date.now();
    const acquired = await acquireWorkspaceLease(lease.db, {
      tenantId: lease.tenantId,
      workspaceId: lease.workspaceId,
      owner,
      ttlMs: Math.max(1, Math.floor(opts.ttlMs)),
      waitMs: Math.max(0, Math.floor(opts.waitMs)),
    });
    const waitedMs = Math.max(0, Date.now() - startedAtMs);
    if (!acquired) {
      throw new Error("workspace is busy");
    }

    try {
      return await fn({ waitedMs });
    } finally {
      await releaseWorkspaceLease(lease.db, {
        tenantId: lease.tenantId,
        workspaceId: lease.workspaceId,
        owner,
      }).catch(() => {
        // Best-effort: leases expire and can be taken over.
      });
    }
  }

  async execute(
    toolId: string,
    toolCallId: string,
    args: unknown,
    audit?: {
      agent_id?: string;
      workspace_id?: string;
      session_id?: string;
      channel?: string;
      thread_id?: string;
      execution_run_id?: string;
      execution_step_id?: string;
      policy_snapshot_id?: string;
    },
  ): Promise<ToolResult> {
    try {
      // Resolve secret handle references in args
      const { resolved: resolvedArgs, secrets } = await this.resolveSecrets(args, {
        tool_id: toolId,
        tool_call_id: toolCallId,
        ...audit,
      });
      this.redactionEngine?.registerSecrets(secrets);

      let result: ToolResult;

      if (toolId.startsWith("mcp.")) {
        result = await this.executeMcp(toolId, toolCallId, resolvedArgs);
      } else {
        switch (toolId) {
          case "tool.fs.read":
            result = await this.executeFsRead(toolCallId, resolvedArgs);
            break;
          case "tool.http.fetch":
            result = await this.executeHttpFetch(toolCallId, resolvedArgs);
            break;
          case "tool.fs.write":
            result = await this.executeFsWrite(toolCallId, resolvedArgs);
            break;
          case "tool.exec":
            result = await this.executeExec(toolCallId, resolvedArgs);
            break;
          case "tool.node.dispatch":
            result = this.nodeDispatchService
              ? await this.executeNodeDispatch(toolCallId, resolvedArgs, audit)
              : {
                  tool_call_id: toolCallId,
                  output: "",
                  error: "node dispatch is not configured",
                };
            break;
          default:
            result = {
              tool_call_id: toolCallId,
              output: "",
              error: `unknown tool: ${toolId}`,
            };
            break;
        }
      }

      // Redact any resolved secret values from the output
      if (secrets.length > 0) {
        const redact = (text: string): string => {
          if (this.redactionEngine) {
            return this.redactionEngine.redactText(text).redacted;
          }
          return this.redactValues(text, secrets);
        };

        if (result.output) {
          result = { ...result, output: redact(result.output) };
        }
        if (result.error) {
          result = { ...result, error: redact(result.error) };
        }
        if (result.provenance) {
          result = {
            ...result,
            provenance: {
              ...result.provenance,
              content: redact(result.provenance.content),
            },
          };
        }
      }

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        tool_call_id: toolCallId,
        output: "",
        error: message,
      };
    }
  }

  private assertSandboxed(filePath: string): string {
    const resolvedHome = resolve(this.home);
    const resolvedPath = resolve(resolvedHome, filePath);
    const rel = relative(resolvedHome, resolvedPath);

    if (rel !== "" && (rel.startsWith("..") || isAbsolute(rel))) {
      throw new Error(`path escapes workspace: ${filePath}`);
    }
    return resolvedPath;
  }

  private async executeNodeDispatch(
    toolCallId: string,
    args: unknown,
    audit?: {
      execution_run_id?: string;
      execution_step_id?: string;
    },
  ): Promise<ToolResult> {
    const parsed = args as Record<string, unknown> | null;
    const rawCapability = typeof parsed?.["capability"] === "string" ? parsed["capability"] : "";
    const rawAction = typeof parsed?.["action"] === "string" ? parsed["action"] : "";
    const capability = rawCapability.trim();
    const actionToken = rawAction.trim();

    if (!capability) {
      return {
        tool_call_id: toolCallId,
        output: "",
        error: "missing required argument: capability",
      };
    }
    if (!actionToken) {
      return {
        tool_call_id: toolCallId,
        output: "",
        error: "missing required argument: action",
      };
    }

    const parsedAction = ActionPrimitiveKind.safeParse(actionToken);
    if (!parsedAction.success) {
      return {
        tool_call_id: toolCallId,
        output: "",
        error: `invalid action: expected ActionPrimitiveKind (got '${actionToken}')`,
      };
    }

    const required = requiredCapability(parsedAction.data);
    if (!required) {
      return {
        tool_call_id: toolCallId,
        output: "",
        error: `unsupported action for node dispatch: '${parsedAction.data}'`,
      };
    }

    const capabilityId = CapabilityDescriptor.safeParse({ id: capability });
    if (!capabilityId.success) {
      return {
        tool_call_id: toolCallId,
        output: "",
        error: `invalid capability: ${capabilityId.error.message}`,
      };
    }

    const expectedCapability = descriptorIdForClientCapability(required);
    if (capabilityId.data.id !== expectedCapability) {
      return {
        tool_call_id: toolCallId,
        output: "",
        error: `capability '${capabilityId.data.id}' does not match action '${parsedAction.data}' (expected '${expectedCapability}')`,
      };
    }

    const argsRaw = parsed?.["args"];
    const actionArgs =
      argsRaw === undefined
        ? {}
        : argsRaw && typeof argsRaw === "object" && !Array.isArray(argsRaw)
          ? (argsRaw as Record<string, unknown>)
          : undefined;
    if (!actionArgs) {
      return {
        tool_call_id: toolCallId,
        output: "",
        error: "invalid args: expected an object",
      };
    }

    const timeoutMsRaw = parsed?.["timeout_ms"];
    const timeoutMs =
      typeof timeoutMsRaw === "number"
        ? Math.max(1, Math.min(MAX_NODE_DISPATCH_TIMEOUT_MS, Math.floor(timeoutMsRaw)))
        : DEFAULT_NODE_DISPATCH_TIMEOUT_MS;

    const runId = audit?.execution_run_id?.trim() || crypto.randomUUID();
    const stepId = audit?.execution_step_id?.trim() || crypto.randomUUID();
    const attemptId = crypto.randomUUID();

    const action: ActionPrimitive = {
      type: parsedAction.data,
      args: actionArgs,
    };

    let serializedPayload: string;
    try {
      const { taskId, result } = await this.nodeDispatchService!.dispatchAndWait(
        action,
        { runId, stepId, attemptId },
        { timeoutMs },
      );

      const evidence = await this.shapeNodeDispatchEvidence(
        parsedAction.data,
        result.evidence,
        result.result,
        { runId, stepId },
      );

      const payload = {
        ok: result.ok,
        task_id: taskId,
        evidence,
        error: result.error,
      };

      serializedPayload = JSON.stringify(payload);
      if (serializedPayload.length > MAX_RESPONSE_BYTES) {
        const safeError =
          typeof result.error === "string"
            ? result.error.length > 4_096
              ? `${result.error.slice(0, 4_096)}${TRUNCATION_MARKER}`
              : result.error
            : undefined;
        const omitted = {
          ok: result.ok,
          task_id: taskId,
          error: safeError,
          evidence: "[omitted: evidence too large]",
          truncated: true,
        };
        serializedPayload = JSON.stringify(omitted);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      let code = "dispatch_failed";
      let retryable = false;

      if (message.toLowerCase().includes("timeout")) {
        code = "timeout";
        retryable = true;
      } else if (err instanceof NoCapableNodeError) {
        code = "no_capable_node";
      } else if (err instanceof NodeDispatchDeniedError) {
        code = "policy_denied";
      } else if (err instanceof NodeNotPairedError) {
        code = "not_paired";
      }
      serializedPayload = JSON.stringify({
        ok: false,
        error: { code, message, retryable },
      });
    }

    const tagged = tagContent(serializedPayload, "tool");
    return {
      tool_call_id: toolCallId,
      output: sanitizeForModel(tagged),
      provenance: tagged,
    };
  }

  private async shapeNodeDispatchEvidence(
    actionKind: ActionPrimitive["type"],
    evidence: unknown,
    result: unknown,
    scope: { runId: string; stepId: string },
  ): Promise<unknown> {
    if (actionKind !== "Desktop" && actionKind !== "Browser") return evidence;
    if (!this.artifactStore) return evidence;
    const db = this.workspaceLease?.db;
    if (!db) return evidence;

    if (actionKind === "Desktop") {
      const sensitivity = await resolveDesktopEvidenceSensitivity(db, scope);
      const shaped = await shapeDesktopEvidenceForArtifacts({
        db,
        artifactStore: this.artifactStore,
        runId: scope.runId,
        stepId: scope.stepId,
        workspaceId: this.workspaceLease?.workspaceId,
        evidence,
        result,
        sensitivity,
      });
      return shaped.evidence;
    }

    const sensitivity = resolveBrowserEvidenceSensitivity();
    const shaped = await shapeBrowserEvidenceForArtifacts({
      db,
      artifactStore: this.artifactStore,
      runId: scope.runId,
      stepId: scope.stepId,
      workspaceId: this.workspaceLease?.workspaceId,
      evidence,
      result,
      sensitivity,
    });
    return shaped.evidence;
  }

  private async executeFsRead(toolCallId: string, args: unknown): Promise<ToolResult> {
    const parsed = args as Record<string, unknown> | null;
    const rawPath = typeof parsed?.["path"] === "string" ? parsed["path"] : undefined;
    if (!rawPath) {
      return { tool_call_id: toolCallId, output: "", error: "missing required argument: path" };
    }

    const offsetRaw = parsed?.["offset"];
    const limitRaw = parsed?.["limit"];
    const offset = typeof offsetRaw === "number" ? Math.floor(offsetRaw) : undefined;
    const limit = typeof limitRaw === "number" ? Math.floor(limitRaw) : undefined;

    if (offset !== undefined && (Number.isNaN(offset) || offset < 0)) {
      return {
        tool_call_id: toolCallId,
        output: "",
        error: "offset must be a non-negative integer",
      };
    }
    if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
      return { tool_call_id: toolCallId, output: "", error: "limit must be a positive integer" };
    }

    const safePath = this.assertSandboxed(rawPath);
    return await this.withWorkspaceLease(
      toolCallId,
      { ttlMs: 30_000, waitMs: 30_000 },
      async () => {
        const content = await readFile(safePath, "utf-8");
        const resolvedHome = resolve(this.home);
        const relativePath = relative(resolvedHome, safePath);
        const normalizedPath = relativePath.trim().length > 0 ? relativePath : rawPath;

        const selected =
          offset !== undefined || limit !== undefined
            ? (() => {
                const lines = content.split("\n");
                const start = offset ?? 0;
                const sliced =
                  limit !== undefined ? lines.slice(start, start + limit) : lines.slice(start);
                return sliced.join("\n");
              })()
            : content;

        const isTruncated = selected.length > MAX_RESPONSE_BYTES;
        const truncated = isTruncated
          ? `${selected.slice(0, MAX_RESPONSE_BYTES)}${TRUNCATION_MARKER}`
          : selected;

        const tagged = tagContent(truncated, "tool");
        return {
          tool_call_id: toolCallId,
          output: sanitizeForModel(tagged),
          provenance: tagged,
          meta: {
            kind: "fs.read",
            path: normalizedPath,
            offset,
            limit,
            raw_chars: content.length,
            selected_chars: selected.length,
            truncated: isTruncated,
            truncation_marker: isTruncated ? TRUNCATION_MARKER : undefined,
          },
        };
      },
    );
  }

  private async executeHttpFetch(toolCallId: string, args: unknown): Promise<ToolResult> {
    const parsed = args as Record<string, unknown> | null;
    const url = typeof parsed?.["url"] === "string" ? parsed["url"] : undefined;
    if (!url) {
      return { tool_call_id: toolCallId, output: "", error: "missing required argument: url" };
    }

    if (isBlockedUrl(url)) {
      return {
        tool_call_id: toolCallId,
        output: "",
        error: "blocked url: requests to private/internal network addresses are denied",
      };
    }

    if (await resolvesToBlockedAddress(url, this.dnsLookup)) {
      return {
        tool_call_id: toolCallId,
        output: "",
        error: "blocked url: requests to private/internal network addresses are denied",
      };
    }

    const method = typeof parsed?.["method"] === "string" ? parsed["method"] : "GET";
    const headersRaw = parsed?.["headers"];
    const headers: Record<string, string> = {};
    if (headersRaw && typeof headersRaw === "object" && !Array.isArray(headersRaw)) {
      for (const [k, v] of Object.entries(headersRaw as Record<string, unknown>)) {
        if (typeof v === "string") {
          headers[k] = v;
        }
      }
    }
    const body = typeof parsed?.["body"] === "string" ? parsed["body"] : undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      const text = await response.text();
      const truncated =
        text.length > MAX_RESPONSE_BYTES
          ? `${text.slice(0, MAX_RESPONSE_BYTES)}...(truncated)`
          : text;

      const tagged = tagContent(truncated, "web", false);
      return {
        tool_call_id: toolCallId,
        output: sanitizeForModel(tagged),
        provenance: tagged,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async executeFsWrite(toolCallId: string, args: unknown): Promise<ToolResult> {
    const parsed = args as Record<string, unknown> | null;
    const rawPath = typeof parsed?.["path"] === "string" ? parsed["path"] : undefined;
    if (!rawPath) {
      return { tool_call_id: toolCallId, output: "", error: "missing required argument: path" };
    }
    const content = typeof parsed?.["content"] === "string" ? parsed["content"] : undefined;
    if (content === undefined) {
      return { tool_call_id: toolCallId, output: "", error: "missing required argument: content" };
    }

    const safePath = this.assertSandboxed(rawPath);
    return await this.withWorkspaceLease(
      toolCallId,
      { ttlMs: 30_000, waitMs: 30_000 },
      async () => {
        await mkdir(dirname(safePath), { recursive: true });
        await writeFile(safePath, content, "utf-8");

        const output = `Wrote ${content.length} bytes to ${safePath}`;
        const tagged = tagContent(output, "tool");
        return {
          tool_call_id: toolCallId,
          output: sanitizeForModel(tagged),
          provenance: tagged,
        };
      },
    );
  }

  private async executeExec(toolCallId: string, args: unknown): Promise<ToolResult> {
    const parsed = args as Record<string, unknown> | null;
    const command = typeof parsed?.["command"] === "string" ? parsed["command"] : undefined;
    if (!command) {
      return { tool_call_id: toolCallId, output: "", error: "missing required argument: command" };
    }

    const cwdRaw = typeof parsed?.["cwd"] === "string" ? parsed["cwd"] : ".";
    const safeCwd = this.assertSandboxed(cwdRaw);

    const timeoutMsRaw = parsed?.["timeout_ms"];
    const timeoutMs =
      typeof timeoutMsRaw === "number"
        ? Math.max(1, Math.min(MAX_EXEC_TIMEOUT_MS, Math.floor(timeoutMsRaw)))
        : DEFAULT_EXEC_TIMEOUT_MS;

    const output = await this.withWorkspaceLease(
      toolCallId,
      {
        ttlMs: Math.max(30_000, timeoutMs + 10_000),
        waitMs: timeoutMs,
      },
      async ({ waitedMs }) =>
        await new Promise<string>((resolvePromise) => {
          const effectiveTimeoutMs = Math.max(1, timeoutMs - waitedMs);
          const child = spawn("sh", ["-c", command], {
            cwd: safeCwd,
            env: sanitizeEnv(),
            stdio: ["ignore", "pipe", "pipe"],
            detached: true,
          });

          const chunks: Buffer[] = [];
          let size = 0;

          const pushChunk = (data: Buffer) => {
            if (size >= MAX_RESPONSE_BYTES) return;
            const remaining = MAX_RESPONSE_BYTES - size;
            if (data.length <= remaining) {
              chunks.push(data);
              size += data.length;
            } else {
              chunks.push(data.subarray(0, remaining));
              size += remaining;
            }
          };

          child.stdout.on("data", (data: Buffer) => pushChunk(data));
          child.stderr.on("data", (data: Buffer) => pushChunk(data));

          let finished = false;
          let timeoutFired = false;

          const killProcessGroup = (signal: NodeJS.Signals) => {
            if (finished) return;
            if (child.pid) {
              try {
                process.kill(-child.pid, signal);
                return;
              } catch {
                // Intentional: best-effort process group kill; fall back to killing the child.
              }
            }
            try {
              child.kill(signal);
            } catch {
              // Intentional: best-effort child kill; ignore errors during cleanup.
            }
          };

          const onTimeout = () => {
            timeoutFired = true;
            killProcessGroup("SIGTERM");
          };

          const timer = setTimeout(onTimeout, effectiveTimeoutMs);
          const killTimer = setTimeout(() => killProcessGroup("SIGKILL"), effectiveTimeoutMs + 250);

          child.on("spawn", () => {
            if (timeoutFired) {
              killProcessGroup("SIGTERM");
            }
          });

          child.on("close", (code) => {
            finished = true;
            clearTimeout(timer);
            clearTimeout(killTimer);
            const combined = Buffer.concat(chunks).toString("utf-8");
            const exitLine = `\n[exit code: ${code ?? "unknown"}]`;
            resolvePromise(combined + exitLine);
          });

          child.on("error", (err) => {
            finished = true;
            clearTimeout(timer);
            clearTimeout(killTimer);
            resolvePromise(`Error spawning command: ${err.message}`);
          });
        }),
    );

    const truncated =
      output.length > MAX_RESPONSE_BYTES
        ? `${output.slice(0, MAX_RESPONSE_BYTES)}...(truncated)`
        : output;

    const tagged = tagContent(truncated, "tool");
    return {
      tool_call_id: toolCallId,
      output: sanitizeForModel(tagged),
      provenance: tagged,
    };
  }

  private async executeMcp(toolId: string, toolCallId: string, args: unknown): Promise<ToolResult> {
    // toolId format: mcp.<serverId>.<toolName>
    const parts = toolId.split(".");
    if (parts.length < 3) {
      return { tool_call_id: toolCallId, output: "", error: `invalid MCP tool ID: ${toolId}` };
    }

    const serverId = parts[1]!;
    const toolName = parts.slice(2).join(".");

    const spec = this.mcpServerSpecs.get(serverId);
    if (!spec) {
      return {
        tool_call_id: toolCallId,
        output: "",
        error: `MCP server not found: ${serverId}`,
      };
    }

    const result = await this.mcpManager.callTool(
      spec,
      toolName,
      (args as Record<string, unknown>) ?? {},
    );

    if (result.isError) {
      const errorText = result.content
        .map((c) => (typeof c === "string" ? c : JSON.stringify(c)))
        .join("\n");
      return {
        tool_call_id: toolCallId,
        output: "",
        error: errorText || "MCP tool call failed",
      };
    }

    const output = result.content
      .map((c) => {
        if (
          typeof c === "object" &&
          c !== null &&
          (c as Record<string, unknown>)["type"] === "text"
        ) {
          return String((c as Record<string, unknown>)["text"]);
        }
        return typeof c === "string" ? c : JSON.stringify(c);
      })
      .join("\n");

    const truncated =
      output.length > MAX_RESPONSE_BYTES
        ? `${output.slice(0, MAX_RESPONSE_BYTES)}...(truncated)`
        : output;

    const tagged = tagContent(truncated, "tool", false);
    return {
      tool_call_id: toolCallId,
      output: sanitizeForModel(tagged),
      provenance: tagged,
    };
  }

  /**
   * Walk the args object tree, resolve any string values starting with
   * "secret:<handle_id>" to their actual secret values.
   * Returns the resolved args and the list of resolved secret values for redaction.
   */
  private async resolveSecrets(
    args: unknown,
    audit?: {
      tool_call_id: string;
      tool_id: string;
      agent_id?: string;
      workspace_id?: string;
      session_id?: string;
      channel?: string;
      thread_id?: string;
      policy_snapshot_id?: string;
    },
  ): Promise<{ resolved: unknown; secrets: string[] }> {
    if (!this.secretProvider) {
      return { resolved: args, secrets: [] };
    }

    const secrets: string[] = [];

    const walk = async (value: unknown): Promise<unknown> => {
      if (typeof value === "string" && value.startsWith(SECRET_HANDLE_PREFIX)) {
        const handleId = value.slice(SECRET_HANDLE_PREFIX.length);
        const handle = {
          handle_id: handleId,
          provider: "db" as const,
          scope: handleId,
          created_at: new Date().toISOString(),
        };
        const resolved = await this.secretProvider!.resolve(handle);
        if (audit && this.secretResolutionAuditDal) {
          try {
            const tenantId = this.workspaceLease?.tenantId ?? DEFAULT_TENANT_ID;
            await this.secretResolutionAuditDal.record({
              tenantId,
              toolCallId: audit.tool_call_id,
              toolId: audit.tool_id,
              handleId: handle.handle_id,
              provider: handle.provider,
              scope: handle.scope,
              agentId: audit.agent_id,
              workspaceId: audit.workspace_id,
              sessionId: audit.session_id,
              channel: audit.channel,
              threadId: audit.thread_id,
              policySnapshotId: audit.policy_snapshot_id,
              outcome: resolved !== null ? "resolved" : "failed",
              error: resolved !== null ? undefined : "secret provider returned null",
            });
          } catch {
            // Intentional: ignore audit-write failures so tool execution is not blocked by logging.
          }
        }
        if (resolved !== null) {
          secrets.push(resolved);
          return resolved;
        }
        return value;
      }
      if (Array.isArray(value)) {
        return Promise.all(value.map(walk));
      }
      if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>);
        const result: Record<string, unknown> = {};
        for (const [k, v] of entries) {
          result[k] = await walk(v);
        }
        return result;
      }
      return value;
    };

    const resolved = await walk(args);
    return { resolved, secrets };
  }

  /** Replace all occurrences of secret values in text with [REDACTED]. */
  private redactValues(text: string, secrets: string[]): string {
    let result = text;
    for (const secret of secrets) {
      if (secret.length > 0) {
        result = result.replaceAll(secret, "[REDACTED]");
      }
    }
    return result;
  }
}
