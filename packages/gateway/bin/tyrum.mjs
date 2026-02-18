#!/usr/bin/env node

import { runCli } from "../dist/index.mjs";

try {
  const code = await runCli(process.argv.slice(2));
  if (code !== 0) {
    process.exit(code);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exit(1);
}
