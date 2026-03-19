import { realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { readdir, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Sandbox enforcement
// ---------------------------------------------------------------------------

/**
 * Resolves `filePath` relative to `sandboxRoot` and ensures the result does
 * not escape the sandbox boundary, including via existing symlinks.
 * Returns the resolved absolute path.
 */
export function assertSandboxed(sandboxRoot: string, filePath: string): string {
  const canonicalRoot = resolveCanonicalPath(sandboxRoot);
  const resolved = resolve(sandboxRoot, filePath);
  const canonicalTarget = resolveCanonicalPath(resolved);
  const relativeToRoot = relative(canonicalRoot, canonicalTarget);
  const staysWithinRoot =
    relativeToRoot === "" || (!relativeToRoot.startsWith("..") && !isAbsolute(relativeToRoot));
  if (!staysWithinRoot) {
    throw new Error(`Path escapes sandbox: ${filePath}`);
  }
  return resolved;
}

function resolveCanonicalPath(targetPath: string): string {
  const suffixSegments: string[] = [];
  let current = resolve(targetPath);

  while (true) {
    try {
      const canonicalExistingPath = realpathSync.native(current);
      return suffixSegments.length === 0
        ? canonicalExistingPath
        : resolve(canonicalExistingPath, ...suffixSegments);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw error;
      }
      const parent = dirname(current);
      if (parent === current) {
        throw error;
      }
      suffixSegments.unshift(basename(current));
      current = parent;
    }
  }
}

// ---------------------------------------------------------------------------
// Output truncation
// ---------------------------------------------------------------------------

export function truncateOutput(output: string, maxBytes: number): string {
  if (Buffer.byteLength(output, "utf-8") <= maxBytes) return output;
  const buf = Buffer.from(output, "utf-8");
  const truncated = buf.subarray(0, maxBytes).toString("utf-8");
  return `${truncated}\n... (truncated)`;
}

// ---------------------------------------------------------------------------
// Environment sanitisation for bash execution
// ---------------------------------------------------------------------------

const ENV_DENY_PREFIXES: readonly string[] = ["TYRUM_", "GATEWAY_"];

export function sanitizeEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (ENV_DENY_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// File read helpers
// ---------------------------------------------------------------------------

export function selectReadContent(content: string, offset?: number, limit?: number): string {
  if (offset === undefined && limit === undefined) return content;
  const lines = content.split("\n");
  const start = offset ?? 0;
  const selected = limit !== undefined ? lines.slice(start, start + limit) : lines.slice(start);
  return selected.join("\n");
}

// ---------------------------------------------------------------------------
// Edit helper
// ---------------------------------------------------------------------------

export function replaceExactString(input: {
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
    if (occurrences === 0) throw new Error("old_string not found");
    return {
      updated: input.content.split(input.oldString).join(input.newString),
      replacements: occurrences,
    };
  }
  const first = input.content.indexOf(input.oldString);
  if (first === -1) throw new Error("old_string not found");
  return {
    updated:
      input.content.slice(0, first) +
      input.newString +
      input.content.slice(first + input.oldString.length),
    replacements: 1,
  };
}

// ---------------------------------------------------------------------------
// Structured patch parser + applier
// ---------------------------------------------------------------------------

type PatchSection = { lines: string[] };
type StructuredPatchHunk =
  | { kind: "add"; path: string; lines: string[] }
  | { kind: "delete"; path: string }
  | { kind: "update"; path: string; moveTo?: string; sections: PatchSection[] };

function parseStructuredPatch(patchText: string): StructuredPatchHunk[] {
  const lines = patchText.replaceAll("\r\n", "\n").split("\n");
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  if (lines[0] !== "*** Begin Patch") throw new Error("patch must start with '*** Begin Patch'");
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
        if (!current.startsWith("+")) throw new Error(`invalid add-file line: ${current}`);
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
      if (currentSection.length > 0) sections.push({ lines: currentSection });
      hunks.push({ kind: "update", path, moveTo, sections });
      continue;
    }

    throw new Error(`invalid patch hunk header: ${line}`);
  }

  if (lines.at(-1) !== "*** End Patch") throw new Error("patch must end with '*** End Patch'");
  return hunks;
}

function applyPatchSection(
  content: string,
  section: PatchSection,
  cursor: number,
): { content: string; cursor: number } {
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
  if (index === -1) throw new Error("patch context did not match target file");
  const updated = content.slice(0, index) + after + content.slice(index + before.length);
  return { content: updated, cursor: index + after.length };
}

function normalizeTextForPatching(value: string): { text: string; hasTrailingNewline: boolean } {
  return { text: value.replaceAll("\r\n", "\n"), hasTrailingNewline: value.endsWith("\n") };
}

function renderPatchedText(text: string, hasTrailingNewline: boolean): string {
  return hasTrailingNewline || text.length === 0
    ? `${text}${text.endsWith("\n") ? "" : "\n"}`
    : text;
}

export async function applyPatch(sandboxRoot: string, patchText: string): Promise<string[]> {
  const hunks = parseStructuredPatch(patchText);
  const applied: string[] = [];

  for (const hunk of hunks) {
    const safePath = assertSandboxed(sandboxRoot, hunk.path);
    if (hunk.kind === "add") {
      await mkdir(dirname(safePath), { recursive: true });
      await writeFile(safePath, renderPatchedText(hunk.lines.join("\n"), true), "utf-8");
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
      const result = applyPatchSection(patched, section, cursor);
      patched = result.content;
      cursor = result.cursor;
    }

    const destinationPath = assertSandboxed(sandboxRoot, hunk.moveTo ?? hunk.path);
    await mkdir(dirname(destinationPath), { recursive: true });
    await writeFile(
      destinationPath,
      renderPatchedText(patched, normalized.hasTrailingNewline),
      "utf-8",
    );
    if (destinationPath !== safePath) await rm(safePath, { force: true });
    applied.push(
      `${hunk.moveTo ? "move" : "update"} ${hunk.path}${hunk.moveTo ? ` -> ${hunk.moveTo}` : ""}`,
    );
  }

  return applied;
}

// ---------------------------------------------------------------------------
// Bash execution
// ---------------------------------------------------------------------------

export async function execBash(
  command: string,
  cwd: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<{ output: string; exitCode: number | null }> {
  return new Promise((resolvePromise) => {
    const child = spawn("sh", ["-c", command], {
      cwd,
      env: sanitizeEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    const pushChunk = (data: Buffer) => {
      if (size >= maxBytes) return;
      const remaining = maxBytes - size;
      chunks.push(data.length <= remaining ? data : data.subarray(0, remaining));
      size += Math.min(data.length, remaining);
    };
    child.stdout.on("data", pushChunk);
    child.stderr.on("data", pushChunk);

    let finished = false;
    const killChild = (signal: NodeJS.Signals) => {
      if (finished) return;
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Process groups are not guaranteed everywhere; fall back to the shell itself.
        }
      }
      try {
        child.kill(signal);
      } catch {
        // child may already be gone
      }
    };

    const timer = setTimeout(() => {
      killChild("SIGTERM");
    }, timeoutMs);
    timer.unref();
    const forceKillTimer = setTimeout(() => {
      killChild("SIGKILL");
    }, timeoutMs + 5_000);
    forceKillTimer.unref();

    child.once("close", (code) => {
      finished = true;
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      resolvePromise({ output: Buffer.concat(chunks).toString("utf-8"), exitCode: code });
    });

    child.once("error", (err) => {
      finished = true;
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      resolvePromise({ output: `Error spawning command: ${err.message}`, exitCode: null });
    });
  });
}

// ---------------------------------------------------------------------------
// Glob via recursive walk
// ---------------------------------------------------------------------------

const IGNORED_WALK_DIRS = new Set([".git", "node_modules", "dist", "coverage", ".turbo"]);

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const next = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_WALK_DIRS.has(entry.name)) stack.push(next);
        continue;
      }
      if (entry.isFile()) files.push(next);
    }
  }
  return files;
}

/**
 * Simple wildcard matcher: `*` matches any chars, `?` matches one char.
 */
function wildcardMatch(pattern: string, input: string): boolean {
  if (pattern === input) return true;
  let pi = 0;
  let si = 0;
  let starIndex = -1;
  let matchIndex = 0;
  while (si < input.length) {
    const pc = pattern[pi];
    if (pc === "?" || pc === input[si]) {
      pi += 1;
      si += 1;
      continue;
    }
    if (pc === "*") {
      starIndex = pi;
      matchIndex = si;
      pi += 1;
      continue;
    }
    if (starIndex !== -1) {
      pi = starIndex + 1;
      matchIndex += 1;
      si = matchIndex;
      continue;
    }
    return false;
  }
  while (pattern[pi] === "*") pi += 1;
  return pi === pattern.length;
}

function matchesGlobPattern(pattern: string, relativePath: string): boolean {
  return (
    wildcardMatch(pattern, relativePath) ||
    wildcardMatch(pattern, relativePath.split("/").at(-1) ?? "")
  );
}

export async function globFiles(basePath: string, pattern: string): Promise<string[]> {
  return (await walkFiles(basePath))
    .map((filePath) => relative(basePath, filePath).replaceAll("\\", "/"))
    .filter((filePath) => matchesGlobPattern(pattern, filePath))
    .toSorted((left, right) => left.localeCompare(right));
}

// ---------------------------------------------------------------------------
// Grep
// ---------------------------------------------------------------------------

function buildGrepRegExp(pattern: string, regex: boolean, ignoreCase: boolean): RegExp {
  return regex
    ? new RegExp(pattern, ignoreCase ? "gi" : "g")
    : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), ignoreCase ? "gi" : "g");
}

export async function grepFiles(
  basePath: string,
  pattern: string,
  options: { include?: string; regex?: boolean; ignoreCase?: boolean },
): Promise<string[]> {
  const matcher = buildGrepRegExp(pattern, options.regex ?? false, options.ignoreCase ?? false);
  const matches: string[] = [];
  for (const filePath of await walkFiles(basePath)) {
    const relativePath = relative(basePath, filePath).replaceAll("\\", "/");
    if (options.include && !matchesGlobPattern(options.include, relativePath)) continue;
    const fileStats = await stat(filePath).catch(() => undefined);
    if (!fileStats || fileStats.size > 1_000_000) continue;
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
  return matches;
}
