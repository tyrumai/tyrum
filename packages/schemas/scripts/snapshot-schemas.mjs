#!/usr/bin/env node
/**
 * Generate a JSON snapshot of all schema JSON schemas for compatibility checking.
 * Output goes to stdout so it can be piped or redirected.
 */
import { getAllJsonSchemas } from "../dist/index.mjs";

const schemas = await getAllJsonSchemas();
const sorted = Object.fromEntries(
  Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b)),
);
console.log(JSON.stringify(sorted, null, 2));
