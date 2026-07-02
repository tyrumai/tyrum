#!/usr/bin/env node

export * from "./refinement-github-core.mjs";
export * from "./refinement-github-data.mjs";

import { createSweep, doctor, parseArgs, setup, syncThreadMap } from "./refinement-github-core.mjs";

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node scripts/refinement-github.mjs doctor [--apply]",
      "  node scripts/refinement-github.mjs setup [--apply]",
      "  node scripts/refinement-github.mjs create-sweep [--apply] [--vantage <name>]",
      "  node scripts/refinement-github.mjs sync-thread-map --issue <number> [--parent-issue <number>] [--root-issue <number>] [--thread-id <id>] [--thread-url <url>] [--spawned-from-thread-id <id>] [--apply]",
      "",
      "Defaults to dry-run. Use --apply for GitHub mutations.",
    ].join("\n"),
  );
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.command === "help" || options.command === "--help") {
    printUsage();
    return;
  }

  const handlers = {
    doctor,
    setup,
    "create-sweep": createSweep,
    "sync-thread-map": syncThreadMap,
  };
  const handler = handlers[options.command];
  if (!handler) throw new Error(`Unknown command: ${options.command}`);
  const result = await handler(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
