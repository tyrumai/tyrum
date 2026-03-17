#!/usr/bin/env node

/**
 * Lightweight lint script that detects raw HTML elements which should use
 * shared design-system components instead.
 *
 * Runs as part of `pnpm lint` and follows the same ratchet pattern as
 * oxlint-ratchet.mjs — a JSON baseline allowlists known violations so
 * they can be removed incrementally without blocking new code.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
const baselinePath = path.join(scriptDir, "check-raw-elements-baseline.json");

const SCAN_DIRS = [path.join(repoRoot, "packages/operator-ui/src/components")];

/** Directories to skip (the shared UI primitives themselves use raw elements). */
const SKIP_DIRS = new Set([path.join(repoRoot, "packages/operator-ui/src/components/ui")]);

/** @type {Array<{ pattern: RegExp; message: string; allowComment: string }>} */
const RULES = [
  {
    pattern: /<select(?:[\s>]|$)/,
    message: "Use the shared <Select> component instead of raw <select>",
    allowComment: "ui-lint-allow: raw-select",
  },
  {
    pattern: /<input\s[^>]*type=["']checkbox["']/,
    message: 'Use the shared <Checkbox> component instead of raw <input type="checkbox">',
    allowComment: "ui-lint-allow: raw-checkbox",
  },
  {
    pattern: /globalThis\.confirm\(|window\.confirm\(/,
    message: "Use <ConfirmDangerDialog> instead of globalThis.confirm() / window.confirm()",
    allowComment: "ui-lint-allow: raw-confirm",
  },
];

/** Recursively collect .tsx files under the given directories. */
function collectTsxFiles(dirs) {
  /** @type {string[]} */
  const files = [];

  function walk(dir) {
    if (SKIP_DIRS.has(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
        files.push(full);
      }
    }
  }

  for (const dir of dirs) {
    try {
      walk(dir);
    } catch {
      // Directory may not exist in some environments
    }
  }

  return files;
}

function loadBaseline() {
  try {
    const raw = readFileSync(baselinePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`baseline must be a JSON array at ${baselinePath}`);
    }
    return new Set(parsed);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
      return new Set();
    }
    throw error;
  }
}

/**
 * @param {string} filePath
 * @returns {Array<{ file: string; line: number; message: string; key: string }>}
 */
function checkFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  /** @type {Array<{ file: string; line: number; message: string; key: string }>} */
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue;
      if (line.includes(rule.allowComment)) continue;

      const relPath = path.relative(repoRoot, filePath);
      const key = `${relPath}:${String(i + 1)}`;
      violations.push({
        file: relPath,
        line: i + 1,
        message: rule.message,
        key,
      });
    }
  }

  return violations;
}

try {
  const baseline = loadBaseline();
  const files = collectTsxFiles(SCAN_DIRS);

  /** @type {Array<{ file: string; line: number; message: string; key: string }>} */
  const allViolations = [];

  for (const file of files) {
    allViolations.push(...checkFile(file));
  }

  // Filter out baselined violations (match by file path, not line number,
  // since lines shift as code changes)
  const newViolations = allViolations.filter((v) => !baseline.has(v.file));

  if (newViolations.length === 0) {
    const baselinedCount = allViolations.length - newViolations.length;
    console.log(
      `check-raw-elements passed (${String(baselinedCount)} baselined violation(s) remaining).`,
    );
    process.exit(0);
  }

  console.error("Raw element violations found:");
  for (const v of newViolations) {
    console.error(`  ${v.file}:${String(v.line)} — ${v.message}`);
  }
  console.error(
    `\n${String(newViolations.length)} new violation(s). Use the shared component or add an inline // ui-lint-allow comment.`,
  );
  process.exit(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
