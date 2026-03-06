import type { CliCommand } from "../cli-command.js";

import { parsePositiveInt } from "./common.js";

export function parseElevatedModeCommand(argv: readonly string[]): CliCommand {
  const second = argv[1];
  if (second === "-h" || second === "--help") return { kind: "help" };
  if (!second) throw new Error("elevated-mode requires a subcommand (enter|status|exit)");

  if (second === "status") return parseElevatedModeStatus(argv);
  if (second === "exit") return parseElevatedModeExit(argv);
  if (second === "enter") return parseElevatedModeEnter(argv);

  throw new Error(`unknown elevated-mode subcommand '${second}'`);
}

function parseElevatedModeStatus(argv: readonly string[]): CliCommand {
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "-h" || arg === "--help") return { kind: "help" };
    if (arg.startsWith("-")) {
      throw new Error(`unsupported elevated-mode.status argument '${arg}'`);
    }
    throw new Error(`unexpected elevated-mode.status argument '${arg}'`);
  }
  return { kind: "elevated_mode_status" };
}

function parseElevatedModeExit(argv: readonly string[]): CliCommand {
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "-h" || arg === "--help") return { kind: "help" };
    if (arg.startsWith("-")) {
      throw new Error(`unsupported elevated-mode.exit argument '${arg}'`);
    }
    throw new Error(`unexpected elevated-mode.exit argument '${arg}'`);
  }
  return { kind: "elevated_mode_exit" };
}

function parseElevatedModeEnter(argv: readonly string[]): CliCommand {
  let ttlSeconds: number | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--ttl-seconds") {
      ttlSeconds = parsePositiveInt(argv[i + 1], "--ttl-seconds");
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) {
      throw new Error(`unsupported elevated-mode.enter argument '${arg}'`);
    }
    throw new Error(`unexpected elevated-mode.enter argument '${arg}'`);
  }

  return {
    kind: "elevated_mode_enter",
    ttl_seconds: ttlSeconds,
  };
}
