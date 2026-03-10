#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const MAX_LINES_RULE = "eslint(max-lines)";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const baselinePath = path.join(scriptDir, "oxlint-max-lines-baseline.json");

function loadBaseline() {
  const raw = readFileSync(baselinePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`invalid max-lines baseline at ${baselinePath}`);
  }
  return new Map(
    Object.entries(parsed).map(([filename, count]) => {
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
        throw new Error(`invalid baseline count for ${filename}`);
      }
      return [filename, count];
    }),
  );
}

function runOxlintJson() {
  const oxlintBin = path.join(repoRoot, "node_modules", ".bin", "oxlint");
  const result = spawnSync(oxlintBin, ["-f", "json", "."], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.stderr.trim().length > 0) {
    process.stderr.write(result.stderr);
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    throw new Error("oxlint produced no JSON output");
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `failed to parse oxlint JSON output: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const diagnostics = Array.isArray(parsed?.diagnostics) ? parsed.diagnostics : [];
  return diagnostics;
}

function extractMaxLinesCount(diagnostic) {
  const match = /^File has too many lines \((\d+)\)\.$/.exec(String(diagnostic.message ?? ""));
  if (!match) {
    throw new Error(
      `unable to parse max-lines count for ${String(diagnostic.filename ?? "<unknown>")}`,
    );
  }
  return Number(match[1]);
}

function formatDiagnostic(diagnostic) {
  const label = Array.isArray(diagnostic.labels) ? diagnostic.labels[0] : undefined;
  const span = label?.span;
  const location =
    span && typeof span.line === "number" && typeof span.column === "number"
      ? `:${String(span.line)}:${String(span.column)}`
      : "";
  return `${String(diagnostic.filename ?? "<unknown>")}${location} ${String(diagnostic.code ?? "<unknown>")}: ${String(diagnostic.message ?? "")}`;
}

function compareMaxLines(actualMaxLines, baseline) {
  const regressions = [];

  for (const [filename, actualCount] of actualMaxLines.entries()) {
    const expectedCount = baseline.get(filename);
    if (expectedCount === undefined) {
      regressions.push(
        `${filename}: new ${MAX_LINES_RULE} warning with ${String(actualCount)} lines (not present in baseline)`,
      );
      continue;
    }
    if (actualCount > expectedCount) {
      regressions.push(
        `${filename}: ${String(actualCount)} lines exceeds baseline ${String(expectedCount)}`,
      );
    }
  }

  return regressions.toSorted((a, b) => a.localeCompare(b));
}

try {
  const baseline = loadBaseline();
  const diagnostics = runOxlintJson();
  const nonBaselineDiagnostics = [];
  const actualMaxLines = new Map();

  for (const diagnostic of diagnostics) {
    if (diagnostic?.code === MAX_LINES_RULE && diagnostic?.severity === "warning") {
      actualMaxLines.set(String(diagnostic.filename), extractMaxLinesCount(diagnostic));
      continue;
    }
    nonBaselineDiagnostics.push(diagnostic);
  }

  const regressions = compareMaxLines(actualMaxLines, baseline);
  if (nonBaselineDiagnostics.length === 0 && regressions.length === 0) {
    console.log(
      `oxlint passed with ${String(actualMaxLines.size)} ratcheted ${MAX_LINES_RULE} warning(s).`,
    );
    process.exit(0);
  }

  if (nonBaselineDiagnostics.length > 0) {
    console.error("Unexpected oxlint diagnostics:");
    for (const diagnostic of nonBaselineDiagnostics) {
      console.error(`- ${formatDiagnostic(diagnostic)}`);
    }
  }

  if (regressions.length > 0) {
    console.error(`Max-lines baseline regressions (${String(regressions.length)}):`);
    for (const regression of regressions) {
      console.error(`- ${regression}`);
    }
  }

  process.exit(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
