import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import type { McpServerSpec as McpServerSpecT } from "@tyrum/schemas";
import type { McpManager } from "./mcp-manager.js";
import type { TaggedContent } from "./provenance.js";
import { tagContent } from "./provenance.js";
import { sanitizeForModel } from "./sanitizer.js";
import type { SecretProvider } from "../secret/provider.js";
import type { RedactionEngine } from "../redaction/engine.js";
import type { PolicyBundleManager } from "../policy/bundle.js";

const MAX_RESPONSE_BYTES = 32_768;
const HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
const MAX_EXEC_TIMEOUT_MS = 300_000;

/** Sentinel prefix for secret handle references in tool arguments. */
const SECRET_HANDLE_PREFIX = "secret:";

/* ------------------------------------------------------------------ */
/*  Environment sanitisation for child processes                       */
/* ------------------------------------------------------------------ */

const ENV_DENY_PREFIXES: readonly string[] = ["TYRUM_", "GATEWAY_"];
const ENV_DENY_NAMES: ReadonlySet<string> = new Set([
  "TELEGRAM_BOT_TOKEN",
  "MODEL_GATEWAY_CONFIG",
]);

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

const BLOCKED_HTTP_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
]);

type DnsLookupFn = (
  hostname: string,
) => Promise<readonly LookupAddress[]>;

async function defaultDnsLookup(
  hostname: string,
): Promise<readonly LookupAddress[]> {
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
function parseNumericIPv4(
  hostname: string,
): [number, number, number, number] | null {
  // Single decimal integer: "2130706433" → 127.0.0.1
  if (/^\d+$/.test(hostname)) {
    const n = Number(hostname);
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
    return [
      (n >>> 24) & 0xff,
      (n >>> 16) & 0xff,
      (n >>> 8) & 0xff,
      n & 0xff,
    ];
  }

  // Hex integer: "0x7f000001" → 127.0.0.1
  if (/^0x[0-9a-fA-F]+$/i.test(hostname)) {
    const n = Number(hostname);
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return null;
    return [
      (n >>> 24) & 0xff,
      (n >>> 16) & 0xff,
      (n >>> 8) & 0xff,
      n & 0xff,
    ];
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
  const v4dotted = raw.match(
    /^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );
  if (v4dotted) {
    const [, sa, sb, sc, sd] = v4dotted;
    if (isPrivateIPv4(Number(sa), Number(sb), Number(sc), Number(sd)))
      return true;
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
    if (
      parts.length === 4 &&
      parts.every((p) => /^\d+$/.test(p))
    ) {
      const [a, b, c, d] = parts.map(Number) as [
        number,
        number,
        number,
        number,
      ];
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
    if (
      dotParts.length === 4 &&
      dotParts.every((p) => /^\d+$/.test(p))
    ) {
      const [a, b, c, d] = dotParts.map(Number) as [number, number, number, number];
      if (isPrivateIPv4(a, b, c, d)) return true;
    }

    // Numeric IPv4 evasion (decimal integer, hex, octal)
    const numeric = parseNumericIPv4(hostname);
    if (numeric && isPrivateIPv4(...numeric)) return true;

    return false;
  } catch {
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
    return true;
  }
}

export interface ToolResult {
  tool_call_id: string;
  output: string;
  error?: string;
  provenance?: TaggedContent;
}

export class ToolExecutor {
  private readonly policyBundleManager?: PolicyBundleManager;

  constructor(
    private readonly home: string,
    private readonly mcpManager: McpManager,
    private readonly mcpServerSpecs: ReadonlyMap<string, McpServerSpecT>,
    private readonly fetchImpl: typeof fetch,
    private readonly secretProvider?: SecretProvider,
    private readonly dnsLookup: DnsLookupFn = defaultDnsLookup,
    private readonly redactionEngine?: RedactionEngine,
    policyBundleManager?: PolicyBundleManager,
  ) {
    this.policyBundleManager = policyBundleManager;
  }

  async execute(
    toolId: string,
    toolCallId: string,
    args: unknown,
  ): Promise<ToolResult> {
    // Policy enforcement
    if (this.policyBundleManager) {
      const policyResult = this.policyBundleManager.evaluate("tools");
      if (policyResult.action === "deny") {
        return {
          tool_call_id: toolCallId,
          output: "",
          error: `Tool execution denied by policy: ${policyResult.detail}`,
        };
      }
    }

    try {
      // Resolve secret handle references in args
      const { resolved: resolvedArgs, secrets } = await this.resolveSecrets(args);
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
            result = {
              tool_call_id: toolCallId,
              output: "",
              error: "tool not yet available",
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

  private async executeFsRead(
    toolCallId: string,
    args: unknown,
  ): Promise<ToolResult> {
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
      return { tool_call_id: toolCallId, output: "", error: "offset must be a non-negative integer" };
    }
    if (limit !== undefined && (Number.isNaN(limit) || limit < 1)) {
      return { tool_call_id: toolCallId, output: "", error: "limit must be a positive integer" };
    }

    const safePath = this.assertSandboxed(rawPath);
    const content = await readFile(safePath, "utf-8");

    const selected = offset !== undefined || limit !== undefined
      ? (() => {
          const lines = content.split("\n");
          const start = offset ?? 0;
          const sliced = limit !== undefined ? lines.slice(start, start + limit) : lines.slice(start);
          return sliced.join("\n");
        })()
      : content;

    const truncated = selected.length > MAX_RESPONSE_BYTES
      ? `${selected.slice(0, MAX_RESPONSE_BYTES)}...(truncated)`
      : selected;

    const tagged = tagContent(truncated, "tool");
    return {
      tool_call_id: toolCallId,
      output: sanitizeForModel(tagged),
      provenance: tagged,
    };
  }

  private async executeHttpFetch(
    toolCallId: string,
    args: unknown,
  ): Promise<ToolResult> {
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
      const truncated = text.length > MAX_RESPONSE_BYTES
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

  private async executeFsWrite(
    toolCallId: string,
    args: unknown,
  ): Promise<ToolResult> {
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
    await mkdir(dirname(safePath), { recursive: true });
    await writeFile(safePath, content, "utf-8");

    const output = `Wrote ${content.length} bytes to ${safePath}`;
    const tagged = tagContent(output, "tool");
    return {
      tool_call_id: toolCallId,
      output: sanitizeForModel(tagged),
      provenance: tagged,
    };
  }

  private async executeExec(
    toolCallId: string,
    args: unknown,
  ): Promise<ToolResult> {
    const parsed = args as Record<string, unknown> | null;
    const command = typeof parsed?.["command"] === "string" ? parsed["command"] : undefined;
    if (!command) {
      return { tool_call_id: toolCallId, output: "", error: "missing required argument: command" };
    }

    const cwdRaw = typeof parsed?.["cwd"] === "string" ? parsed["cwd"] : ".";
    const safeCwd = this.assertSandboxed(cwdRaw);

    const timeoutMsRaw = parsed?.["timeout_ms"];
    const timeoutMs = typeof timeoutMsRaw === "number"
      ? Math.max(1, Math.min(MAX_EXEC_TIMEOUT_MS, Math.floor(timeoutMsRaw)))
      : DEFAULT_EXEC_TIMEOUT_MS;

    const output = await new Promise<string>((resolvePromise) => {
      const child = spawn("sh", ["-c", command], {
        cwd: safeCwd,
        env: sanitizeEnv(),
        stdio: ["ignore", "pipe", "pipe"],
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

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
      }, timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);
        const combined = Buffer.concat(chunks).toString("utf-8");
        const exitLine = `\n[exit code: ${code ?? "unknown"}]`;
        resolvePromise(combined + exitLine);
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolvePromise(`Error spawning command: ${err.message}`);
      });
    });

    const truncated = output.length > MAX_RESPONSE_BYTES
      ? `${output.slice(0, MAX_RESPONSE_BYTES)}...(truncated)`
      : output;

    const tagged = tagContent(truncated, "tool");
    return {
      tool_call_id: toolCallId,
      output: sanitizeForModel(tagged),
      provenance: tagged,
    };
  }

  private async executeMcp(
    toolId: string,
    toolCallId: string,
    args: unknown,
  ): Promise<ToolResult> {
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
        if (typeof c === "object" && c !== null && (c as Record<string, unknown>)["type"] === "text") {
          return String((c as Record<string, unknown>)["text"]);
        }
        return typeof c === "string" ? c : JSON.stringify(c);
      })
      .join("\n");

    const truncated = output.length > MAX_RESPONSE_BYTES
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
  ): Promise<{ resolved: unknown; secrets: string[] }> {
    if (!this.secretProvider) {
      return { resolved: args, secrets: [] };
    }

    const secrets: string[] = [];

    const walk = async (value: unknown): Promise<unknown> => {
      if (typeof value === "string" && value.startsWith(SECRET_HANDLE_PREFIX)) {
        const handleId = value.slice(SECRET_HANDLE_PREFIX.length);
        // Look up the full handle from the provider's stored list so that
        // scope (needed by EnvSecretProvider) is populated correctly.
        const allHandles = await this.secretProvider!.list();
        const handle = allHandles.find((h) => h.handle_id === handleId);
        const resolved = handle
          ? await this.secretProvider!.resolve(handle)
          : null;
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
