import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { wildcardMatch } from "@tyrum/runtime-policy";
import { makeToolResult, parseStringArg } from "./tool-executor-local-utils.js";
import type { ToolResult } from "./tool-executor-shared.js";

type SearchToolContext = {
  assertSandboxed: (filePath: string) => string;
};

const IGNORED_WALK_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".turbo"]);

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_WALK_DIRS.has(entry.name)) {
          stack.push(next);
        }
        continue;
      }
      if (entry.isFile()) {
        files.push(next);
      }
    }
  }
  return files;
}

function matchesGlobPattern(pattern: string, relativePath: string): boolean {
  return (
    wildcardMatch(pattern, relativePath) ||
    wildcardMatch(pattern, relativePath.split("/").at(-1) ?? "")
  );
}

function buildGrepRegExp(pattern: string, regex: boolean, ignoreCase: boolean): RegExp {
  return regex
    ? new RegExp(pattern, ignoreCase ? "gi" : "g")
    : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), ignoreCase ? "gi" : "g");
}

export async function executeGlobTool(
  context: SearchToolContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const parsed = args as Record<string, unknown> | null;
  const pattern = parseStringArg(parsed, "pattern") ?? parseStringArg(parsed, "glob");
  if (!pattern) {
    return { tool_call_id: toolCallId, output: "", error: "missing required argument: pattern" };
  }
  const basePath = context.assertSandboxed(parseStringArg(parsed, "path") ?? ".");
  const matches = (await walkFiles(basePath))
    .map((filePath) => relative(basePath, filePath).replaceAll("\\", "/"))
    .filter((filePath) => matchesGlobPattern(pattern, filePath))
    .toSorted((left, right) => left.localeCompare(right));
  return makeToolResult(toolCallId, matches.join("\n"), "tool");
}

export async function executeGrepTool(
  context: SearchToolContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const parsed = args as Record<string, unknown> | null;
  const pattern = parseStringArg(parsed, "pattern");
  if (!pattern) {
    return { tool_call_id: toolCallId, output: "", error: "missing required argument: pattern" };
  }
  const basePath = context.assertSandboxed(parseStringArg(parsed, "path") ?? ".");
  const includePattern = parseStringArg(parsed, "include");
  const regex = parsed?.["regex"] === true;
  const ignoreCase = parsed?.["ignore_case"] === true;
  let matcher: RegExp;
  try {
    matcher = buildGrepRegExp(pattern, regex, ignoreCase);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      tool_call_id: toolCallId,
      output: "",
      error: regex ? `invalid regex pattern: ${message}` : message,
    };
  }

  const matches: string[] = [];
  for (const filePath of await walkFiles(basePath)) {
    const relativePath = relative(basePath, filePath).replaceAll("\\", "/");
    if (includePattern && !matchesGlobPattern(includePattern, relativePath)) continue;
    const fileStats = await stat(filePath);
    if (fileStats.size > 1_000_000) continue;
    const content = await readFile(filePath, "utf-8").catch(() => undefined);
    if (!content || content.includes("\u0000")) continue;
    const lines = content.split("\n");
    for (const [index, line] of lines.entries()) {
      matcher.lastIndex = 0;
      if (matcher.test(line)) {
        matches.push(`${relativePath}:${String(index + 1)}:${line}`);
      }
    }
  }

  return makeToolResult(toolCallId, matches.join("\n"), "tool");
}
