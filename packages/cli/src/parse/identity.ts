import type { CliCommand } from "../cli-command.js";

export function parseIdentityCommand(argv: readonly string[]): CliCommand {
  const second = argv[1];
  if (second === "-h" || second === "--help") return { kind: "help" };
  if (!second || second === "show") {
    for (let i = 2; i < argv.length; i += 1) {
      const arg = argv[i];
      if (!arg) continue;
      if (arg === "-h" || arg === "--help") return { kind: "help" };
      if (arg.startsWith("-")) {
        throw new Error(`unsupported identity.show argument '${arg}'`);
      }
      throw new Error(`unexpected identity.show argument '${arg}'`);
    }
    return { kind: "identity_show" };
  }
  if (second === "init") {
    for (let i = 2; i < argv.length; i += 1) {
      const arg = argv[i];
      if (!arg) continue;
      if (arg === "-h" || arg === "--help") return { kind: "help" };
      if (arg.startsWith("-")) {
        throw new Error(`unsupported identity.init argument '${arg}'`);
      }
      throw new Error(`unexpected identity.init argument '${arg}'`);
    }
    return { kind: "identity_init" };
  }
  throw new Error(`unknown identity subcommand '${second}'`);
}
