import { normalizeCommanderError as normalizeSharedCommanderError } from "@tyrum/cli-utils";

export function collectValues(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

export function normalizeCommanderError(error: unknown): never {
  throw normalizeSharedCommanderError(error);
}

export function normalizeArgv(argv: readonly string[]): string[] {
  if (argv[0] === "config" && (argv.length === 1 || argv[1] === "--help" || argv[1] === "-h")) {
    return argv.length === 1 ? ["config", "show"] : ["config", "show", ...argv.slice(1)];
  }
  if (argv[0] === "identity" && (argv.length === 1 || argv[1] === "--help" || argv[1] === "-h")) {
    return argv.length === 1 ? ["identity", "show"] : ["identity", "show", ...argv.slice(1)];
  }
  if (argv[0] === "approvals" && (argv.length === 1 || argv[1] === "--help" || argv[1] === "-h")) {
    return argv.length === 1 ? ["approvals", "list"] : ["approvals", "list", ...argv.slice(1)];
  }
  return [...argv];
}
