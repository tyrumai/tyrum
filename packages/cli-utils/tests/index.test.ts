import { CommanderError } from "commander";
import { describe, expect, it } from "vitest";

import { normalizeCommanderError } from "../src/index.js";

describe("normalizeCommanderError", () => {
  it("normalizes unknown options", () => {
    const error = new CommanderError(
      1,
      "commander.unknownOption",
      "error: unknown option '--nope'",
    );

    expect(normalizeCommanderError(error)).toEqual(new Error("unknown argument '--nope'"));
  });

  it("normalizes unknown commands", () => {
    const error = new CommanderError(
      1,
      "commander.unknownCommand",
      "error: unknown command 'oops'",
    );

    expect(normalizeCommanderError(error)).toEqual(new Error("unknown command 'oops'"));
  });

  it("normalizes missing option values without regex parsing", () => {
    const error = new CommanderError(
      1,
      "commander.optionMissingArgument",
      "error: option '-g, --gateway <url>' argument missing",
    );

    expect(normalizeCommanderError(error)).toEqual(new Error("--gateway requires a value"));
  });
});
