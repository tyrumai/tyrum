import { CommanderError } from "commander";

export function collectValues(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

export function normalizeCommanderError(error: unknown): never {
  if (!(error instanceof CommanderError)) {
    throw error;
  }

  if (error.code === "commander.unknownOption") {
    const match = error.message.match(/unknown option '([^']+)'/);
    throw new Error(`unknown argument '${match?.[1] ?? ""}'`);
  }

  if (error.code === "commander.unknownCommand") {
    const match = error.message.match(/unknown command '([^']+)'/);
    throw new Error(`unknown command '${match?.[1] ?? ""}'`);
  }

  if (error.code === "commander.optionMissingArgument") {
    const match = error.message.match(/option '([^']+?)\s+<[^>]+>'/);
    const flag = match?.[1]
      ?.split(",")
      .map((part) => part.trim())
      .at(-1);
    throw new Error(`${flag ?? "option"} requires a value`);
  }

  throw new Error(error.message.replace(/^error:\s*/i, ""));
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
