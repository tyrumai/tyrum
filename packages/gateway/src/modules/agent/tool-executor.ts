import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve, normalize } from "node:path";
import type { McpServerSpec as McpServerSpecT } from "@tyrum/schemas";
import type { McpManager } from "./mcp-manager.js";
import type { TaggedContent } from "./provenance.js";
import { tagContent } from "./provenance.js";
import { sanitizeForModel } from "./sanitizer.js";
import type { SecretProvider } from "../secret/provider.js";

const MAX_RESPONSE_BYTES = 32_768;
const HTTP_TIMEOUT_MS = 30_000;
const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
const MAX_EXEC_TIMEOUT_MS = 300_000;

/** Sentinel prefix for secret handle references in tool arguments. */
const SECRET_HANDLE_PREFIX = "secret:";

const BLOCKED_HTTP_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "169.254.169.254", // cloud metadata
  "metadata.google.internal",
]);

function isBlockedUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (BLOCKED_HTTP_HOSTS.has(parsed.hostname)) return true;

    // Block RFC 1918 / link-local ranges (IPv4)
    const parts = parsed.hostname.split(".");
    if (parts[0] === "10") return true;
    if (parts[0] === "172") {
      const second = Number(parts[1]);
      if (second >= 16 && second <= 31) return true;
    }
    if (parts[0] === "192" && parts[1] === "168") return true;

    return false;
  } catch {
    return true; // invalid URL → block
  }
}

export interface ToolResult {
  tool_call_id: string;
  output: string;
  error?: string;
  provenance?: TaggedContent;
}

export class ToolExecutor {
  constructor(
    private readonly home: string,
    private readonly mcpManager: McpManager,
    private readonly mcpServerSpecs: ReadonlyMap<string, McpServerSpecT>,
    private readonly fetchImpl: typeof fetch,
    private readonly secretProvider?: SecretProvider,
  ) {}

  async execute(
    toolId: string,
    toolCallId: string,
    args: unknown,
  ): Promise<ToolResult> {
    try {
      // Resolve secret handle references in args
      const { resolved: resolvedArgs, secrets } = await this.resolveSecrets(args);

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
      if (secrets.length > 0 && result.output) {
        result = { ...result, output: this.redactValues(result.output, secrets) };
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
    const resolved = resolve(this.home, filePath);
    const normalized = normalize(resolved);
    const normalizedHome = normalize(this.home);

    if (!normalized.startsWith(normalizedHome + "/") && normalized !== normalizedHome) {
      throw new Error(`path escapes workspace: ${filePath}`);
    }
    return normalized;
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
