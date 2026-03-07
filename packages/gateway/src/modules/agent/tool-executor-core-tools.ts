import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import type { McpServerSpec as McpServerSpecT } from "@tyrum/schemas";
import type { McpManager } from "./mcp-manager.js";
import { tagContent } from "./provenance.js";
import { sanitizeForModel } from "./sanitizer.js";
import {
  DEFAULT_EXEC_TIMEOUT_MS,
  HTTP_TIMEOUT_MS,
  MAX_EXEC_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  TRUNCATION_MARKER,
  isBlockedUrl,
  resolvesToBlockedAddress,
  sanitizeEnv,
} from "./tool-executor-shared.js";
import type { DnsLookupFn, ToolResult } from "./tool-executor-shared.js";

type WorkspaceLeaseRunner = <T>(
  toolCallId: string,
  opts: { ttlMs: number; waitMs: number },
  fn: (ctx: { waitedMs: number }) => Promise<T>,
) => Promise<T>;

type CoreToolContext = {
  home: string;
  fetchImpl: typeof fetch;
  dnsLookup: DnsLookupFn;
  mcpManager: McpManager;
  mcpServerSpecs: ReadonlyMap<string, McpServerSpecT>;
  assertSandboxed: (filePath: string) => string;
  withWorkspaceLease: WorkspaceLeaseRunner;
};

function truncateOutput(output: string): string {
  return output.length > MAX_RESPONSE_BYTES
    ? `${output.slice(0, MAX_RESPONSE_BYTES)}${TRUNCATION_MARKER}`
    : output;
}

function parseStringArg(args: Record<string, unknown> | null, key: string): string | undefined {
  return typeof args?.[key] === "string" ? (args[key] as string) : undefined;
}

function selectReadContent(content: string, offset?: number, limit?: number): string {
  if (offset === undefined && limit === undefined) return content;
  const lines = content.split("\n");
  const start = offset ?? 0;
  const selected = limit !== undefined ? lines.slice(start, start + limit) : lines.slice(start);
  return selected.join("\n");
}

async function executeFsRead(
  context: CoreToolContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const parsed = args as Record<string, unknown> | null;
  const rawPath = parseStringArg(parsed, "path");
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

  const safePath = context.assertSandboxed(rawPath);
  return await context.withWorkspaceLease(
    toolCallId,
    { ttlMs: 30_000, waitMs: 30_000 },
    async () => {
      const content = await readFile(safePath, "utf-8");
      const relativePath = relative(resolve(context.home), safePath);
      const normalizedPath = relativePath.trim().length > 0 ? relativePath : rawPath;
      const selected = selectReadContent(content, offset, limit);
      const isTruncated = selected.length > MAX_RESPONSE_BYTES;
      const tagged = tagContent(truncateOutput(selected), "tool");
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

async function executeHttpFetch(
  context: CoreToolContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const parsed = args as Record<string, unknown> | null;
  const url = parseStringArg(parsed, "url");
  if (!url) {
    return { tool_call_id: toolCallId, output: "", error: "missing required argument: url" };
  }

  if (isBlockedUrl(url) || (await resolvesToBlockedAddress(url, context.dnsLookup))) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "blocked url: requests to private/internal network addresses are denied",
    };
  }

  const method = parseStringArg(parsed, "method") ?? "GET";
  const headers: Record<string, string> = {};
  const headersRaw = parsed?.["headers"];
  if (headersRaw && typeof headersRaw === "object" && !Array.isArray(headersRaw)) {
    for (const [key, value] of Object.entries(headersRaw as Record<string, unknown>)) {
      if (typeof value === "string") {
        headers[key] = value;
      }
    }
  }

  const body = parseStringArg(parsed, "body");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await context.fetchImpl(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const tagged = tagContent(truncateOutput(await response.text()), "web", false);
    return {
      tool_call_id: toolCallId,
      output: sanitizeForModel(tagged),
      provenance: tagged,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function executeFsWrite(
  context: CoreToolContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const parsed = args as Record<string, unknown> | null;
  const rawPath = parseStringArg(parsed, "path");
  if (!rawPath) {
    return { tool_call_id: toolCallId, output: "", error: "missing required argument: path" };
  }

  const content = parseStringArg(parsed, "content");
  if (content === undefined) {
    return { tool_call_id: toolCallId, output: "", error: "missing required argument: content" };
  }

  const safePath = context.assertSandboxed(rawPath);
  return await context.withWorkspaceLease(
    toolCallId,
    { ttlMs: 30_000, waitMs: 30_000 },
    async () => {
      await mkdir(dirname(safePath), { recursive: true });
      await writeFile(safePath, content, "utf-8");
      const tagged = tagContent(`Wrote ${content.length} bytes to ${safePath}`, "tool");
      return {
        tool_call_id: toolCallId,
        output: sanitizeForModel(tagged),
        provenance: tagged,
      };
    },
  );
}

async function executeExec(
  context: CoreToolContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const parsed = args as Record<string, unknown> | null;
  const command = parseStringArg(parsed, "command");
  if (!command) {
    return { tool_call_id: toolCallId, output: "", error: "missing required argument: command" };
  }

  const safeCwd = context.assertSandboxed(parseStringArg(parsed, "cwd") ?? ".");
  const timeoutMsRaw = parsed?.["timeout_ms"];
  const timeoutMs =
    typeof timeoutMsRaw === "number"
      ? Math.max(1, Math.min(MAX_EXEC_TIMEOUT_MS, Math.floor(timeoutMsRaw)))
      : DEFAULT_EXEC_TIMEOUT_MS;

  const output = await context.withWorkspaceLease(
    toolCallId,
    { ttlMs: Math.max(30_000, timeoutMs + 10_000), waitMs: timeoutMs },
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
          chunks.push(data.length <= remaining ? data : data.subarray(0, remaining));
          size += Math.min(data.length, remaining);
        };

        child.stdout.on("data", pushChunk);
        child.stderr.on("data", pushChunk);

        let finished = false;
        let timeoutFired = false;
        const killProcessGroup = (signal: NodeJS.Signals) => {
          if (finished) return;
          if (child.pid) {
            try {
              process.kill(-child.pid, signal);
              return;
            } catch {
              // Intentional: process-group cleanup is best-effort during timeout handling.
              // Best-effort process-group cleanup; fall back to the child pid.
            }
          }
          try {
            child.kill(signal);
          } catch {
            // Intentional: shutdown races during child cleanup should not mask the tool result.
            // Best-effort cleanup; ignore shutdown races.
          }
        };

        const timer = setTimeout(() => {
          timeoutFired = true;
          killProcessGroup("SIGTERM");
        }, effectiveTimeoutMs);
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
          resolvePromise(
            `${Buffer.concat(chunks).toString("utf-8")}\n[exit code: ${code ?? "unknown"}]`,
          );
        });
        child.on("error", (err) => {
          finished = true;
          clearTimeout(timer);
          clearTimeout(killTimer);
          resolvePromise(`Error spawning command: ${err.message}`);
        });
      }),
  );

  const tagged = tagContent(truncateOutput(output), "tool");
  return {
    tool_call_id: toolCallId,
    output: sanitizeForModel(tagged),
    provenance: tagged,
  };
}

export async function executeMcpTool(
  context: CoreToolContext,
  toolId: string,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const parts = toolId.split(".");
  if (parts.length < 3) {
    return { tool_call_id: toolCallId, output: "", error: `invalid MCP tool ID: ${toolId}` };
  }

  const serverId = parts[1]!;
  const toolName = parts.slice(2).join(".");
  const spec = context.mcpServerSpecs.get(serverId);
  if (!spec) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: `MCP server not found: ${serverId}`,
    };
  }

  const result = await context.mcpManager.callTool(
    spec,
    toolName,
    (args as Record<string, unknown>) ?? {},
  );
  if (result.isError) {
    const errorText = result.content
      .map((content) => (typeof content === "string" ? content : JSON.stringify(content)))
      .join("\n");
    return {
      tool_call_id: toolCallId,
      output: "",
      error: errorText || "MCP tool call failed",
    };
  }

  const output = result.content
    .map((content) => {
      if (
        typeof content === "object" &&
        content !== null &&
        (content as Record<string, unknown>)["type"] === "text"
      ) {
        return String((content as Record<string, unknown>)["text"]);
      }
      return typeof content === "string" ? content : JSON.stringify(content);
    })
    .join("\n");

  const tagged = tagContent(truncateOutput(output), "tool", false);
  return {
    tool_call_id: toolCallId,
    output: sanitizeForModel(tagged),
    provenance: tagged,
  };
}

export async function executeCoreTool(
  context: CoreToolContext,
  toolId: string,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult | null> {
  switch (toolId) {
    case "tool.fs.read":
      return await executeFsRead(context, toolCallId, args);
    case "tool.http.fetch":
      return await executeHttpFetch(context, toolCallId, args);
    case "tool.fs.write":
      return await executeFsWrite(context, toolCallId, args);
    case "tool.exec":
      return await executeExec(context, toolCallId, args);
    default:
      return null;
  }
}
