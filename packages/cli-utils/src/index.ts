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

export function normalizeCommanderError(error: unknown): Error {
  if (!(error instanceof CommanderError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  if (error.code === "commander.unknownOption") {
    const match = error.message.match(/unknown option '([^']+)'/);
    return new Error(`unknown argument '${match?.[1] ?? ""}'`);
  }

  if (error.code === "commander.unknownCommand") {
    const match = error.message.match(/unknown command '([^']+)'/);
    return new Error(`unknown command '${match?.[1] ?? ""}'`);
  }

  if (error.code === "commander.optionMissingArgument") {
    const match = error.message.match(/option '([^']+?)\s+<[^>]+>'/);
    const flag = match?.[1]
      ?.split(",")
      .map((part) => part.trim())
      .at(-1);
    return new Error(`${flag ?? "option"} requires a value`);
  }

  return new Error(error.message.replace(/^error:\s*/i, ""));
}
