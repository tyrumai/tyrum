import { configureCommander, normalizeCommanderError } from "@tyrum/cli-utils";
import { Command } from "commander";

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
      tlsAllowSelfSigned?: boolean;
      reconnect?: boolean;
    };

export function parseTuiCliArgs(argv: readonly string[]): TuiCliCommand {
  if (argv.length === 0) return { kind: "start" };

  const [first] = argv;
  if (!first) return { kind: "start" };

  if (first === "help") {
    return { kind: "help" };
  }
  if (first === "version") {
    return { kind: "version" };
  }
  if (argv.some((arg) => arg === "-h" || arg === "--help")) {
    return { kind: "help" };
  }
  if (argv.some((arg) => arg === "-v" || arg === "--version")) {
    return { kind: "version" };
  }

  let result: TuiCliCommand | undefined;
  const program = configureCommander(
    new Command().name("tyrum-tui").version("", "-v, --version", ""),
  );

  program
    .command("start")
    .allowExcessArguments(false)
    .allowUnknownOption(false)
    .option("--gateway <url>")
    .option("--token <token>")
    .option("--home, --tyrum-home <dir>")
    .option("--device-identity <path>")
    .option("--tls-fingerprint256 <hex>")
    .option("--tls-allow-self-signed")
    .option("--reconnect")
    .option("--no-reconnect")
    .action(
      (options: {
        gateway?: string;
        token?: string;
        tyrumHome?: string;
        deviceIdentity?: string;
        tlsFingerprint256?: string;
        tlsAllowSelfSigned?: boolean;
        reconnect?: boolean;
      }) => {
        result = {
          kind: "start",
          gatewayUrl: options.gateway,
          token: options.token,
          tyrumHome: options.tyrumHome,
          deviceIdentityPath: options.deviceIdentity,
          tlsCertFingerprint256: options.tlsFingerprint256,
          tlsAllowSelfSigned: options.tlsAllowSelfSigned,
          reconnect: options.reconnect,
        };
      },
    );

  const normalizedArgv = first.startsWith("-") ? ["start", ...argv] : argv;
  try {
    program.parse(normalizedArgv, { from: "user" });
  } catch (error) {
    throw normalizeCommanderError(error);
  }

  if (!result) {
    throw new Error(`unknown argument '${first}'`);
  }

  return result;
}
