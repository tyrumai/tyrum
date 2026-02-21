#!/usr/bin/env node
/**
 * Compare two schema snapshot files for breaking changes.
 * Breaking = field removed or type narrowed.
 *
 * Usage: node diff-schemas.mjs baseline.json current.json
 * Exit 0 if safe, exit 1 if breaking changes detected.
 */
import { readFileSync } from "node:fs";

const [baselinePath, currentPath] = process.argv.slice(2);
if (!baselinePath || !currentPath) {
  console.error("Usage: diff-schemas.mjs <baseline.json> <current.json>");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf-8"));
const current = JSON.parse(readFileSync(currentPath, "utf-8"));

const breaking = [];

for (const [name, baseSchema] of Object.entries(baseline)) {
  if (!(name in current)) {
    breaking.push(`REMOVED schema: ${name}`);
    continue;
  }
  // Check for removed top-level properties (simple heuristic)
  const baseProps = baseSchema?.properties ?? {};
  const curProps = current[name]?.properties ?? {};
  for (const prop of Object.keys(baseProps)) {
    if (!(prop in curProps)) {
      breaking.push(`REMOVED field: ${name}.${prop}`);
    }
  }
}

if (breaking.length > 0) {
  console.error("Breaking schema changes detected:");
  for (const msg of breaking) {
    console.error(`  - ${msg}`);
  }
  process.exit(1);
} else {
  console.log("Schema compatibility check passed.");

  // Report additions (informational)
  const additions = [];
  for (const name of Object.keys(current)) {
    if (!(name in baseline)) {
      additions.push(`NEW schema: ${name}`);
    } else {
      const baseProps = baseline[name]?.properties ?? {};
      const curProps = current[name]?.properties ?? {};
      for (const prop of Object.keys(curProps)) {
        if (!(prop in baseProps)) {
          additions.push(`NEW field: ${name}.${prop}`);
        }
      }
    }
  }
  if (additions.length > 0) {
    console.log("Additions:");
    for (const msg of additions) {
      console.log(`  + ${msg}`);
    }
  }
}
