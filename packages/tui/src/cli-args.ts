export type TuiCliCommand =
  | { kind: "help" }
  | { kind: "version" }
  | {
      kind: "start";
      gatewayUrl?: string;
      token?: string;
      tyrumHome?: string;
      deviceIdentityPath?: string;
      tlsCertFingerprint256?: string;
      reconnect?: boolean;
    };

export function parseTuiCliArgs(argv: readonly string[]): TuiCliCommand {
  if (argv.length === 0) return { kind: "start" };

  const [first, ...rest] = argv;
  if (!first) return { kind: "start" };

  if (first === "-h" || first === "--help" || first === "help") return { kind: "help" };
  if (first === "-v" || first === "--version" || first === "version") return { kind: "version" };

  const args = first === "start" ? rest : argv;

  const command: Extract<TuiCliCommand, { kind: "start" }> = { kind: "start" };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "-h" || arg === "--help") {
      return { kind: "help" };
    }
    if (arg === "-v" || arg === "--version") {
      return { kind: "version" };
    }

    if (arg === "--gateway") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--gateway requires a value");
      }
      command.gatewayUrl = value;
      index += 1;
      continue;
    }

    if (arg === "--token") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--token requires a value");
      }
      command.token = value;
      index += 1;
      continue;
    }

    if (arg === "--home" || arg === "--tyrum-home") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      command.tyrumHome = value;
      index += 1;
      continue;
    }

    if (arg === "--device-identity") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--device-identity requires a value");
      }
      command.deviceIdentityPath = value;
      index += 1;
      continue;
    }

    if (arg === "--tls-fingerprint256") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--tls-fingerprint256 requires a value");
      }
      command.tlsCertFingerprint256 = value;
      index += 1;
      continue;
    }

    if (arg === "--no-reconnect") {
      command.reconnect = false;
      continue;
    }

    if (arg === "--reconnect") {
      command.reconnect = true;
      continue;
    }

    throw new Error(`unknown argument '${arg}'`);
  }

  return command;
}
