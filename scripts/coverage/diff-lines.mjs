#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

function normalizePath(p) {
  return p.replaceAll("\\", "/");
}

function parseArgs(argv) {
  const args = {
    base: undefined,
    min: undefined,
    coveragePath: "coverage/coverage-final.json",
    verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--base" && argv[i + 1]) {
      args.base = argv[++i];
      continue;
    }
    if (token === "--min" && argv[i + 1]) {
      args.min = Number.parseFloat(argv[++i]);
      continue;
    }
    if (token === "--coverage" && argv[i + 1]) {
      args.coveragePath = argv[++i];
      continue;
    }
    if (token === "--verbose") {
      args.verbose = true;
      continue;
    }
  }

  const envMin = process.env["COVERAGE_DIFF_LINES_MIN"];
  if (args.min === undefined && envMin) {
    args.min = Number.parseFloat(envMin);
  }
  if (args.min === undefined || Number.isNaN(args.min)) args.min = 80;

  return args;
}

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function resolveBaseCommit(explicitBase) {
  if (explicitBase) return explicitBase;

  // Prefer origin/main when available, otherwise fall back to main.
  for (const candidate of ["origin/main", "main"]) {
    try {
      return runGit(["merge-base", "HEAD", candidate]).trim();
    } catch {
      // try next candidate
    }
  }

  throw new Error("unable to resolve base commit (use --base <sha>)");
}

function isInScopeSourceFile(filePath) {
  const p = normalizePath(filePath);
  if (!/^(packages|apps)\/[^/]+\/src\//.test(p)) return false;
  if (!/\.(ts|tsx|js|jsx)$/.test(p)) return false;
  if (p.endsWith(".d.ts")) return false;
  return true;
}

function parseUnifiedDiffForAddedLines(diffText) {
  const filesToLines = new Map();

  const lines = diffText.split("\n");
  let currentFile = null;
  let newLine = null;
  let oldLine = null;

  for (const rawLine of lines) {
    const line = rawLine;

    if (line.startsWith("diff --git ")) {
      // Example: diff --git a/packages/x/src/a.ts b/packages/x/src/b.ts
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      currentFile = match ? match[2] : null;
      newLine = null;
      oldLine = null;
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith("@@")) {
      // Example: @@ -1,0 +1,5 @@
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!match) continue;
      oldLine = Number.parseInt(match[1], 10);
      newLine = Number.parseInt(match[3], 10);
      continue;
    }

    if (newLine === null || oldLine === null) continue;

    if (line.startsWith("+") && !line.startsWith("+++")) {
      const set = filesToLines.get(currentFile) ?? new Set();
      set.add(newLine);
      filesToLines.set(currentFile, set);
      newLine++;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      oldLine++;
      continue;
    }

    if (line.startsWith(" ")) {
      oldLine++;
      newLine++;
      continue;
    }

    if (line.startsWith("\\")) {
      continue;
    }
  }

  return filesToLines;
}

function shouldIgnoreChangedLine(text) {
  const t = text.trim();
  if (t.length === 0) return true;
  if (t.startsWith("//")) return true;
  if (t.startsWith("/*")) return true;
  if (t.startsWith("*")) return true;
  if (t.startsWith("*/")) return true;
  return false;
}

function buildLineCoverageMap(entry) {
  const s = entry.s ?? {};
  const statementMap = entry.statementMap ?? {};

  const lineCounts = new Map();
  for (const [id, loc] of Object.entries(statementMap)) {
    const line = loc?.start?.line;
    if (typeof line !== "number") continue;
    const count = s[id] ?? 0;
    const prev = lineCounts.get(line);
    if (prev === undefined || count > prev) lineCounts.set(line, count);
  }
  return lineCounts;
}

function hasDeclareModifier(node) {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node) ?? [];
  return modifiers.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword);
}

function isCoverableStatement(node) {
  if (ts.isBlock(node)) return false;
  if (ts.isEmptyStatement(node)) return false;
  if (ts.isNotEmittedStatement(node)) return false;
  if (ts.isImportDeclaration(node)) return false;
  if (ts.isImportEqualsDeclaration(node)) return false;
  if (ts.isInterfaceDeclaration(node)) return false;
  if (ts.isTypeAliasDeclaration(node)) return false;
  if (ts.isNamespaceExportDeclaration(node)) return false;

  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return false;
    if (
      node.moduleSpecifier === undefined &&
      node.exportClause !== undefined &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.length === 0
    ) {
      return false;
    }
  }

  if (hasDeclareModifier(node)) return false;
  if (ts.isFunctionDeclaration(node) && node.body === undefined) return false;

  return true;
}

function scriptKindFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".ts") return ts.ScriptKind.TS;
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".js") return ts.ScriptKind.JS;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  return ts.ScriptKind.Unknown;
}

function buildCoverableStatementLineSet(filePath, fileText) {
  const sourceFile = ts.createSourceFile(
    filePath,
    fileText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFromPath(filePath),
  );

  const coverableLines = new Set();
  const addLineForNode = (node) => {
    const start = node.getStart(sourceFile);
    const { line } = ts.getLineAndCharacterOfPosition(sourceFile, start);
    coverableLines.add(line + 1);
  };

  const visit = (node) => {
    if (ts.isStatement(node) && isCoverableStatement(node)) {
      addLineForNode(node);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return coverableLines;
}

function pct(covered, total) {
  if (!total) return 100;
  return (covered / total) * 100;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();

  const base = resolveBaseCommit(args.base);
  const range = `${base}...HEAD`;

  const diffText = runGit([
    "diff",
    "-U0",
    "--diff-filter=AMR",
    range,
    "--",
    "packages",
    "apps",
  ]);

  const addedLinesByFile = parseUnifiedDiffForAddedLines(diffText);
  const scopeFiles = [...addedLinesByFile.entries()]
    .filter(([filePath]) => isInScopeSourceFile(filePath))
    .map(([filePath, lineSet]) => [filePath, [...lineSet].sort((a, b) => a - b)]);

  if (scopeFiles.length === 0) {
    process.stdout.write(
      `diff-coverage: no in-scope source changes detected (range ${range}); skipping.\n`,
    );
    return;
  }

  const coveragePath = path.resolve(repoRoot, args.coveragePath);
  const coverageRaw = readFileSync(coveragePath, "utf8");
  const coverage = JSON.parse(coverageRaw);
  const coverageByPath = new Map(
    Object.entries(coverage).map(([k, v]) => [normalizePath(k), v]),
  );

  let total = 0;
  let covered = 0;
  const uncovered = [];

  for (const [filePath, changedLines] of scopeFiles) {
    const absPath = normalizePath(path.resolve(repoRoot, filePath));
    const entry = coverageByPath.get(absPath);

    let fileText;
    try {
      fileText = readFileSync(path.resolve(repoRoot, filePath), "utf8");
    } catch {
      continue;
    }
    const fileLines = fileText.split("\n");

    if (!entry) {
      const coverableLines = buildCoverableStatementLineSet(filePath, fileText);
      for (const lineNo of changedLines) {
        const text = fileLines[lineNo - 1] ?? "";
        if (shouldIgnoreChangedLine(text)) continue;
        if (!coverableLines.has(lineNo)) continue;
        total++;
        uncovered.push({
          file: filePath,
          line: lineNo,
          text: text.trimEnd(),
          reason: "no_coverage",
        });
      }
      continue;
    }

    const lineCoverage = buildLineCoverageMap(entry);
    for (const lineNo of changedLines) {
      const text = fileLines[lineNo - 1] ?? "";
      if (shouldIgnoreChangedLine(text)) continue;

      const count = lineCoverage.get(lineNo);
      if (count === undefined) continue; // not coverable by Istanbul line metrics

      total++;
      if (count > 0) {
        covered++;
      } else {
        uncovered.push({ file: filePath, line: lineNo, text: text.trimEnd(), reason: "uncovered" });
      }
    }
  }

  if (total === 0) {
    process.stdout.write(
      `diff-coverage: no coverable changed lines found (range ${range}); passing.\n`,
    );
    return;
  }

  const percent = pct(covered, total);
  const min = args.min;

  process.stdout.write(
    `diff-coverage: ${percent.toFixed(2)}% (${covered}/${total}) coverable changed lines covered (min ${min}%), base ${base}\n`,
  );

  if (uncovered.length > 0 && args.verbose) {
    process.stdout.write("\nUncovered changed lines:\n");
    for (const item of uncovered.slice(0, 200)) {
      process.stdout.write(`- ${item.file}:${item.line} [${item.reason}] ${item.text}\n`);
    }
    if (uncovered.length > 200) {
      process.stdout.write(`- ... (${uncovered.length - 200} more)\n`);
    }
  }

  if (percent < min) {
    if (uncovered.length > 0 && !args.verbose) {
      process.stdout.write("\nUncovered changed lines (use --verbose for more):\n");
      for (const item of uncovered.slice(0, 50)) {
        process.stdout.write(`- ${item.file}:${item.line} [${item.reason}] ${item.text}\n`);
      }
      if (uncovered.length > 50) {
        process.stdout.write(`- ... (${uncovered.length - 50} more)\n`);
      }
    }
    process.exitCode = 1;
  }
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`coverage/diff-lines: ${message}\n`);
  process.exitCode = 1;
}
