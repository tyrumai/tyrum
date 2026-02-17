import { readFile } from "node:fs/promises";
import { resolve, normalize } from "node:path";
import type { McpServerSpec as McpServerSpecT } from "@tyrum/schemas";
import type { McpManager } from "./mcp-manager.js";
import type { TaggedContent } from "./provenance.js";
import { tagContent } from "./provenance.js";
import { sanitizeForModel } from "./sanitizer.js";
import type { SecretProvider } from "../secret/provider.js";

const MAX_RESPONSE_BYTES = 32_768;
const HTTP_TIMEOUT_MS = 30_000;

/** Sentinel prefix for secret handle references in tool arguments. */
const SECRET_HANDLE_PREFIX = "secret:";

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
          case "tool.exec":
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

    const safePath = this.assertSandboxed(rawPath);
    const content = await readFile(safePath, "utf-8");

    const truncated = content.length > MAX_RESPONSE_BYTES
      ? `${content.slice(0, MAX_RESPONSE_BYTES)}...(truncated)`
      : content;

    const tagged = tagContent(truncated, "tool", true);
    return { tool_call_id: toolCallId, output: truncated, provenance: tagged };
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
