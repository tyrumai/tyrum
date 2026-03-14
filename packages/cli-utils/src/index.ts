import { Command, CommanderError } from "commander";

export const COMMANDER_SILENT_OUTPUT = {
  writeOut: () => undefined,
  writeErr: () => undefined,
};

export function configureCommander(command: Command): Command {
  return command
    .helpOption(false)
    .showHelpAfterError(false)
    .allowExcessArguments(false)
    .allowUnknownOption(false)
    .configureOutput(COMMANDER_SILENT_OUTPUT)
    .exitOverride();
}

function readCommanderQuotedSegment(message: string, prefix: string): string | null {
  const prefixIndex = message.indexOf(prefix);
  if (prefixIndex === -1) {
    return null;
  }

  const quoteStart = message.indexOf("'", prefixIndex + prefix.length);
  if (quoteStart === -1) {
    return null;
  }

  const quoteEnd = message.indexOf("'", quoteStart + 1);
  if (quoteEnd === -1) {
    return null;
  }

  return message.slice(quoteStart + 1, quoteEnd);
}

function readMissingOptionFlag(message: string): string | null {
  const optionSpec = readCommanderQuotedSegment(message, "option ");
  if (!optionSpec) {
    return null;
  }

  const valueStart = optionSpec.lastIndexOf(" <");
  const flagsOnly = valueStart === -1 ? optionSpec : optionSpec.slice(0, valueStart);
  const flags = flagsOnly
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return flags.at(-1) ?? null;
}

export function normalizeCommanderError(error: unknown): Error {
  if (!(error instanceof CommanderError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  if (error.code === "commander.unknownOption") {
    const option = readCommanderQuotedSegment(error.message, "unknown option ");
    return new Error(`unknown argument '${option ?? ""}'`);
  }

  if (error.code === "commander.unknownCommand") {
    const command = readCommanderQuotedSegment(error.message, "unknown command ");
    return new Error(`unknown command '${command ?? ""}'`);
  }

  if (error.code === "commander.optionMissingArgument") {
    const flag = readMissingOptionFlag(error.message);
    return new Error(`${flag ?? "option"} requires a value`);
  }

  return new Error(error.message.replace(/^error:\s*/i, ""));
}
