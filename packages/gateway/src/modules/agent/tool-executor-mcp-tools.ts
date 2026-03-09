import type { McpServerSpec as McpServerSpecT } from "@tyrum/schemas";
import type { SecretProvider } from "../secret/provider.js";
import { buildBuiltinExaServerSpec } from "./builtin-exa.js";
import type { McpManager } from "./mcp-manager.js";
import { tagContent } from "./provenance.js";
import { sanitizeForModel } from "./sanitizer.js";
import {
  MAX_RESPONSE_BYTES,
  TRUNCATION_MARKER,
  isBlockedUrl,
  resolvesToBlockedAddress,
} from "./tool-executor-shared.js";
import type { DnsLookupFn, ToolResult } from "./tool-executor-shared.js";

type McpToolContext = {
  dnsLookup: DnsLookupFn;
  mcpManager: McpManager;
  mcpServerSpecs: ReadonlyMap<string, McpServerSpecT>;
  secretProvider?: SecretProvider;
};

function truncateOutput(output: string): string {
  return output.length > MAX_RESPONSE_BYTES
    ? `${output.slice(0, MAX_RESPONSE_BYTES)}${TRUNCATION_MARKER}`
    : output;
}

function makeToolResult(toolCallId: string, output: string): ToolResult {
  const tagged = tagContent(truncateOutput(output), "web", false);
  return {
    tool_call_id: toolCallId,
    output: sanitizeForModel(tagged),
    provenance: tagged,
  };
}

function parseStringArg(args: Record<string, unknown> | null, key: string): string | undefined {
  return typeof args?.[key] === "string" ? (args[key] as string) : undefined;
}

function parseNumberArg(args: Record<string, unknown> | null, key: string): number | undefined {
  const value = args?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeMcpText(content: unknown): string {
  if (
    typeof content === "object" &&
    content !== null &&
    (content as Record<string, unknown>)["type"] === "text"
  ) {
    return String((content as Record<string, unknown>)["text"] ?? "");
  }
  return typeof content === "string" ? content : JSON.stringify(content);
}

async function callBuiltinExaTool(
  context: McpToolContext,
  toolName: string,
  args: Record<string, unknown>,
) {
  const serverSpec = await buildBuiltinExaServerSpec(context.secretProvider);
  return await context.mcpManager.callTool(serverSpec, toolName, args);
}

function parseMcpToolResult(
  result: Awaited<ReturnType<McpManager["callTool"]>>,
  toolCallId: string,
): ToolResult {
  if (result.isError) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error:
        result.content.map((item) => normalizeMcpText(item)).join("\n") || "MCP tool call failed",
    };
  }
  return makeToolResult(
    toolCallId,
    result.content.map((item) => normalizeMcpText(item)).join("\n"),
  );
}

export async function executeWebSearchTool(
  context: McpToolContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const parsed = (args as Record<string, unknown> | null) ?? {};
  const query = parseStringArg(parsed, "query");
  if (!query) {
    return { tool_call_id: toolCallId, output: "", error: "missing required argument: query" };
  }
  const callArgs: Record<string, unknown> = { query };
  const searchType = parseStringArg(parsed, "type");
  const numResults = parseNumberArg(parsed, "num_results") ?? parseNumberArg(parsed, "numResults");
  if (searchType) callArgs["type"] = searchType;
  if (numResults !== undefined) callArgs["numResults"] = Math.max(1, Math.floor(numResults));
  return parseMcpToolResult(
    await callBuiltinExaTool(context, "web_search_exa", callArgs),
    toolCallId,
  );
}

export async function executeCodeSearchTool(
  context: McpToolContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const parsed = (args as Record<string, unknown> | null) ?? {};
  const query = parseStringArg(parsed, "query");
  if (!query) {
    return { tool_call_id: toolCallId, output: "", error: "missing required argument: query" };
  }
  const callArgs: Record<string, unknown> = { query };
  const tokensNum = parseNumberArg(parsed, "tokens_num") ?? parseNumberArg(parsed, "tokensNum");
  if (tokensNum !== undefined) callArgs["tokensNum"] = Math.max(256, Math.floor(tokensNum));
  return parseMcpToolResult(
    await callBuiltinExaTool(context, "get_code_context_exa", callArgs),
    toolCallId,
  );
}

export async function executeWebFetchTool(
  context: McpToolContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const parsed = (args as Record<string, unknown> | null) ?? {};
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

  const mode = parseStringArg(parsed, "mode") ?? "raw";
  const prompt = parseStringArg(parsed, "prompt");
  if (mode === "extract" && !prompt) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "prompt is required when mode is 'extract'",
    };
  }

  const crawlResult = parseMcpToolResult(
    await callBuiltinExaTool(context, "crawling_exa", { url }),
    toolCallId,
  );
  if (crawlResult.error) return crawlResult;
  if (mode !== "extract" || !prompt) return crawlResult;
  return crawlResult;
}

export async function executeMcpTool(
  context: McpToolContext,
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
    return { tool_call_id: toolCallId, output: "", error: `MCP server not found: ${serverId}` };
  }

  return parseMcpToolResult(
    await context.mcpManager.callTool(spec, toolName, (args as Record<string, unknown>) ?? {}),
    toolCallId,
  );
}
