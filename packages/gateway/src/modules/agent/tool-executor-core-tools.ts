import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { McpServerSpec as McpServerSpecT } from "@tyrum/schemas";
import type { SecretProvider } from "../secret/provider.js";
import type { McpManager } from "./mcp-manager.js";
import { tagContent } from "./provenance.js";
import { sanitizeForModel } from "./sanitizer.js";
import {
  DEFAULT_EXEC_TIMEOUT_MS,
  MAX_EXEC_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  TRUNCATION_MARKER,
  sanitizeEnv,
} from "./tool-executor-shared.js";
import type { DnsLookupFn, ToolResult } from "./tool-executor-shared.js";
import {
  makeToolResult,
  normalizeTextForPatching,
  parseBooleanArg,
  parseNumberArg,
  parseStringArg,
  renderPatchedText,
  resolvePathArg,
  selectReadContent,
} from "./tool-executor-local-utils.js";
import { executeGlobTool, executeGrepTool } from "./tool-executor-search-tools.js";
import {
  executeCodeSearchTool,
  executeWebFetchTool,
  executeWebSearchTool,
} from "./tool-executor-mcp-tools.js";
export { executeMcpTool } from "./tool-executor-mcp-tools.js";

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
  secretProvider?: SecretProvider;
  assertSandboxed: (filePath: string) => string;
  withWorkspaceLease: WorkspaceLeaseRunner;
};

type StructuredPatchHunk =
  | { kind: "add"; path: string; lines: string[] }
  | { kind: "delete"; path: string }
  | { kind: "update"; path: string; moveTo?: string; sections: PatchSection[] };

type PatchSection = { lines: string[] };

function truncateOutput(output: string): string {
  return output.length > MAX_RESPONSE_BYTES
    ? `${output.slice(0, MAX_RESPONSE_BYTES)}${TRUNCATION_MARKER}`
    : output;
}

async function executeFsRead(
  context: CoreToolContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const parsed = args as Record<string, unknown> | null;
  const rawPath = resolvePathArg(parsed);
  if (!rawPath) {
    return { tool_call_id: toolCallId, output: "", error: "missing required argument: path" };
  }

  const offset = parseNumberArg(parsed, "offset");
  const limit = parseNumberArg(parsed, "limit");
  if (offset !== undefined && (offset < 0 || !Number.isInteger(offset))) {
    return { tool_call_id: toolCallId, output: "", error: "offset must be a non-negative integer" };
  }
  if (limit !== undefined && (limit < 1 || !Number.isInteger(limit))) {
    return { tool_call_id: toolCallId, output: "", error: "limit must be a positive integer" };
  }

  const safePath = context.assertSandboxed(rawPath);
  return await context.withWorkspaceLease(
    toolCallId,
    { ttlMs: 30_000, waitMs: 30_000 },
    async () => {
      const content = await readFile(safePath, "utf-8");
      const selected = selectReadContent(content, offset, limit);
      const relativePath = relative(resolve(context.home), safePath);
      const isTruncated = selected.length > MAX_RESPONSE_BYTES;
      const tagged = tagContent(truncateOutput(selected), "tool");
      return {
        tool_call_id: toolCallId,
        output: sanitizeForModel(tagged),
        provenance: tagged,
        meta: {
          kind: "fs.read",
          path: relativePath.trim().length > 0 ? relativePath : rawPath,
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

async function executeFsWrite(
  context: CoreToolContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const parsed = args as Record<string, unknown> | null;
  const rawPath = resolvePathArg(parsed);
  const content = parseStringArg(parsed, "content");
  if (!rawPath) {
    return { tool_call_id: toolCallId, output: "", error: "missing required argument: path" };
  }
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
      return makeToolResult(toolCallId, `Wrote ${content.length} bytes to ${safePath}`, "tool");
    },
  );
}

function replaceExactString(input: {
  content: string;
  oldString: string;
  newString: string;
  replaceAll: boolean;
}): { updated: string; replacements: number } {
  if (!input.oldString) {
    throw new Error("old_string must not be empty");
  }
  if (input.replaceAll) {
    const occurrences = input.content.split(input.oldString).length - 1;
    if (occurrences === 0) {
      throw new Error("old_string not found");
    }
    return {
      updated: input.content.split(input.oldString).join(input.newString),
      replacements: occurrences,
    };
  }

  const first = input.content.indexOf(input.oldString);
  if (first === -1) {
    throw new Error("old_string not found");
  }
  const second = input.content.indexOf(input.oldString, first + input.oldString.length);
  if (second !== -1) {
    throw new Error("old_string matched multiple times; set replace_all=true");
  }
  return {
    updated:
      input.content.slice(0, first) +
      input.newString +
      input.content.slice(first + input.oldString.length),
    replacements: 1,
  };
}

async function executeFsEdit(
  context: CoreToolContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const parsed = args as Record<string, unknown> | null;
  const rawPath = resolvePathArg(parsed);
  const oldString = parseStringArg(parsed, "old_string") ?? parseStringArg(parsed, "oldString");
  const newString = parseStringArg(parsed, "new_string") ?? parseStringArg(parsed, "newString");
  const replaceAll =
    parseBooleanArg(parsed, "replace_all") ?? parseBooleanArg(parsed, "replaceAll") ?? false;
  if (!rawPath) {
    return { tool_call_id: toolCallId, output: "", error: "missing required argument: path" };
  }
  if (oldString === undefined || newString === undefined) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "missing required arguments: old_string and new_string",
    };
  }

  const safePath = context.assertSandboxed(rawPath);
  return await context.withWorkspaceLease(
    toolCallId,
    { ttlMs: 30_000, waitMs: 30_000 },
    async () => {
      const content = await readFile(safePath, "utf-8");
      const result = replaceExactString({ content, oldString, newString, replaceAll });
      await writeFile(safePath, result.updated, "utf-8");
      return makeToolResult(
        toolCallId,
        `Edited ${safePath} (${String(result.replacements)} replacement${result.replacements === 1 ? "" : "s"})`,
        "tool",
      );
    },
  );
}

function parseStructuredPatch(patchText: string): StructuredPatchHunk[] {
  const lines = patchText.replaceAll("\r\n", "\n").split("\n");
  if (lines[0] !== "*** Begin Patch") {
    throw new Error("patch must start with '*** Begin Patch'");
  }
  const hunks: StructuredPatchHunk[] = [];
  let index = 1;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line === "*** End Patch") break;

    if (line.startsWith("*** Add File: ")) {
      const path = line.slice("*** Add File: ".length).trim();
      const addLines: string[] = [];
      index += 1;
      while (index < lines.length) {
        const current = lines[index] ?? "";
        if (current.startsWith("*** ")) break;
        if (!current.startsWith("+")) {
          throw new Error(`invalid add-file line: ${current}`);
        }
        addLines.push(current.slice(1));
        index += 1;
      }
      hunks.push({ kind: "add", path, lines: addLines });
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      hunks.push({ kind: "delete", path: line.slice("*** Delete File: ".length).trim() });
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const path = line.slice("*** Update File: ".length).trim();
      index += 1;
      let moveTo: string | undefined;
      if ((lines[index] ?? "").startsWith("*** Move to: ")) {
        moveTo = (lines[index] ?? "").slice("*** Move to: ".length).trim();
        index += 1;
      }
      const sections: PatchSection[] = [];
      let currentSection: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? "";
        if (current === "*** End of File") {
          index += 1;
          continue;
        }
        if (current.startsWith("*** ")) break;
        if (current === "@@" || current.startsWith("@@ ")) {
          if (currentSection.length > 0) {
            sections.push({ lines: currentSection });
            currentSection = [];
          }
          index += 1;
          continue;
        }
        if (![" ", "+", "-"].includes(current[0] ?? "")) {
          throw new Error(`invalid update line: ${current}`);
        }
        currentSection.push(current);
        index += 1;
      }
      if (currentSection.length > 0) {
        sections.push({ lines: currentSection });
      }
      hunks.push({ kind: "update", path, moveTo, sections });
      continue;
    }

    throw new Error(`invalid patch hunk header: ${line}`);
  }

  if (lines.at(-1) !== "*** End Patch") {
    throw new Error("patch must end with '*** End Patch'");
  }
  return hunks;
}

function applyPatchSection(
  content: string,
  section: PatchSection,
  cursor: number,
): {
  content: string;
  cursor: number;
} {
  const before = section.lines
    .filter((line) => line.startsWith(" ") || line.startsWith("-"))
    .map((line) => line.slice(1))
    .join("\n");
  const after = section.lines
    .filter((line) => line.startsWith(" ") || line.startsWith("+"))
    .map((line) => line.slice(1))
    .join("\n");

  const searchFrom = Math.max(0, cursor);
  const index = before.length === 0 ? searchFrom : content.indexOf(before, searchFrom);
  if (index === -1) {
    throw new Error("patch context did not match target file");
  }
  const updated = content.slice(0, index) + after + content.slice(index + before.length);
  return { content: updated, cursor: index + after.length };
}

async function executeApplyPatch(
  context: CoreToolContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const parsed = args as Record<string, unknown> | null;
  const patch = parseStringArg(parsed, "patch");
  if (!patch) {
    return { tool_call_id: toolCallId, output: "", error: "missing required argument: patch" };
  }

  return await context.withWorkspaceLease(
    toolCallId,
    { ttlMs: 30_000, waitMs: 30_000 },
    async () => {
      const hunks = parseStructuredPatch(patch);
      const applied: string[] = [];

      for (const hunk of hunks) {
        const safePath = context.assertSandboxed(hunk.path);
        if (hunk.kind === "add") {
          await mkdir(dirname(safePath), { recursive: true });
          await writeFile(safePath, hunk.lines.join("\n"), "utf-8");
          applied.push(`add ${hunk.path}`);
          continue;
        }
        if (hunk.kind === "delete") {
          await rm(safePath, { force: true });
          applied.push(`delete ${hunk.path}`);
          continue;
        }

        const original = await readFile(safePath, "utf-8");
        const normalized = normalizeTextForPatching(original);
        let patched = normalized.text;
        let cursor = 0;
        for (const section of hunk.sections) {
          const appliedSection = applyPatchSection(patched, section, cursor);
          patched = appliedSection.content;
          cursor = appliedSection.cursor;
        }

        const destinationPath = context.assertSandboxed(hunk.moveTo ?? hunk.path);
        await mkdir(dirname(destinationPath), { recursive: true });
        await writeFile(
          destinationPath,
          renderPatchedText(patched, normalized.hasTrailingNewline),
          "utf-8",
        );
        if (destinationPath !== safePath) {
          await rm(safePath, { force: true });
        }
        applied.push(
          `${hunk.moveTo ? "move" : "update"} ${hunk.path}${hunk.moveTo ? ` -> ${hunk.moveTo}` : ""}`,
        );
      }

      return makeToolResult(toolCallId, applied.join("\n") || "Patch applied.", "tool");
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
  const timeoutMsRaw = parseNumberArg(parsed, "timeout_ms");
  const timeoutMs =
    timeoutMsRaw !== undefined
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
        const killGroup = (signal: NodeJS.Signals) => {
          if (finished) return;
          if (child.pid) {
            try {
              process.kill(-child.pid, signal);
              return;
            } catch {}
          }
          try {
            child.kill(signal);
          } catch {}
        };

        const timer = setTimeout(() => {
          killGroup("SIGTERM");
        }, effectiveTimeoutMs);
        const killTimer = setTimeout(() => {
          killGroup("SIGKILL");
        }, effectiveTimeoutMs + 250);

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

  return makeToolResult(toolCallId, output, "tool");
}

export async function executeCoreTool(
  context: CoreToolContext,
  toolId: string,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult | null> {
  switch (toolId) {
    case "read":
      return await executeFsRead(context, toolCallId, args);
    case "write":
      return await executeFsWrite(context, toolCallId, args);
    case "edit":
      return await executeFsEdit(context, toolCallId, args);
    case "apply_patch":
      return await executeApplyPatch(context, toolCallId, args);
    case "bash":
      return await executeExec(context, toolCallId, args);
    case "glob":
      return await executeGlobTool(context, toolCallId, args);
    case "grep":
      return await executeGrepTool(context, toolCallId, args);
    case "webfetch":
      return await executeWebFetchTool(context, toolCallId, args);
    case "websearch":
      return await executeWebSearchTool(context, toolCallId, args);
    case "codesearch":
      return await executeCodeSearchTool(context, toolCallId, args);
    default:
      return null;
  }
}
