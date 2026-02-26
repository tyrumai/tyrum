import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  createNodeFileDeviceIdentityStorage,
  formatDeviceIdentityError,
  loadOrCreateDeviceIdentity,
} from "@tyrum/client";

export const VERSION = "0.1.0";

type CliCommand =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "config_set"; gateway_url: string; auth_token: string }
  | { kind: "config_show" }
  | { kind: "identity_init" }
  | { kind: "identity_show" };

function resolveTyrumHome(): string {
  const fromEnv = process.env["TYRUM_HOME"]?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".tyrum");
}

function resolveOperatorDir(home = resolveTyrumHome()): string {
  return join(home, "operator");
}

function resolveOperatorConfigPath(home = resolveTyrumHome()): string {
  return join(resolveOperatorDir(home), "config.json");
}

function resolveOperatorDeviceIdentityPath(home = resolveTyrumHome()): string {
  return join(resolveOperatorDir(home), "device-identity.json");
}

function printCliHelp(): void {
  console.log(
    [
      "tyrum-cli (operator CLI)",
      "",
      "Usage:",
      "  tyrum-cli --help",
      "  tyrum-cli --version",
      "  tyrum-cli config show",
      "  tyrum-cli config set --gateway-url <url> --token <token>",
      "  tyrum-cli identity show",
      "  tyrum-cli identity init",
      "",
      "Environment:",
      "  TYRUM_HOME  Defaults to ~/.tyrum",
    ].join("\n"),
  );
}

function parseCliArgs(argv: readonly string[]): CliCommand {
  if (argv.length === 0) return { kind: "help" };

  const [first, second] = argv;
  if (first === "-h" || first === "--help") return { kind: "help" };
  if (first === "--version") return { kind: "version" };

  if (first === "config") {
    if (!second || second === "show") return { kind: "config_show" };
    if (second !== "set") {
      throw new Error(`unknown config subcommand '${second}'`);
    }

    let gatewayUrl: string | undefined;
    let token: string | undefined;
    for (let i = 2; i < argv.length; i += 1) {
      const arg = argv[i];
      if (!arg) continue;

      if (arg === "--gateway-url") {
        gatewayUrl = argv[i + 1];
        i += 1;
        continue;
      }

      if (arg === "--token") {
        token = argv[i + 1];
        i += 1;
        continue;
      }

      if (arg === "-h" || arg === "--help") return { kind: "help" };

      if (arg.startsWith("-")) {
        throw new Error(`unsupported config.set argument '${arg}'`);
      }

      throw new Error(`unexpected config.set argument '${arg}'`);
    }

    const normalizedGatewayUrl = gatewayUrl?.trim();
    const normalizedToken = token?.trim();
    if (!normalizedGatewayUrl) throw new Error("config.set requires --gateway-url <url>");
    if (!normalizedToken) throw new Error("config.set requires --token <token>");

    return {
      kind: "config_set",
      gateway_url: normalizedGatewayUrl,
      auth_token: normalizedToken,
    };
  }

  if (first === "identity") {
    if (!second || second === "show") return { kind: "identity_show" };
    if (second === "init") return { kind: "identity_init" };
    throw new Error(`unknown identity subcommand '${second}'`);
  }

  throw new Error(`unknown command '${first}'`);
}

async function loadOperatorConfig(path: string): Promise<{
  gateway_url?: string;
  auth_token?: string;
}> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("config file must be a JSON object");
    }
    const asRecord = parsed as Record<string, unknown>;
    const gatewayUrl =
      typeof asRecord.gateway_url === "string" ? asRecord.gateway_url.trim() : undefined;
    const authToken =
      typeof asRecord.auth_token === "string" ? asRecord.auth_token.trim() : undefined;
    return { gateway_url: gatewayUrl, auth_token: authToken };
  } catch (error) {
    const asErr = error as NodeJS.ErrnoException;
    if (asErr?.code === "ENOENT") return {};
    throw error;
  }
}

async function saveOperatorConfig(
  path: string,
  config: { gateway_url: string; auth_token: string },
): Promise<void> {
  const dir = resolveOperatorDir(resolveTyrumHome());
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  let command: CliCommand;
  try {
    command = parseCliArgs(normalizedArgv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    printCliHelp();
    return 1;
  }

  if (command.kind === "help") {
    printCliHelp();
    return 0;
  }

  if (command.kind === "version") {
    console.log(VERSION);
    return 0;
  }

  const tyrumHome = resolveTyrumHome();

  if (command.kind === "config_show") {
    const configPath = resolveOperatorConfigPath(tyrumHome);
    const config = await loadOperatorConfig(configPath);
    const maskedToken = config.auth_token ? "[set]" : "[unset]";
    console.log(
      [
        "operator config",
        `home=${tyrumHome}`,
        `gateway_url=${config.gateway_url ?? "[unset]"}`,
        `auth_token=${maskedToken}`,
      ].join(" "),
    );
    return 0;
  }

  if (command.kind === "config_set") {
    const configPath = resolveOperatorConfigPath(tyrumHome);
    await saveOperatorConfig(configPath, {
      gateway_url: command.gateway_url,
      auth_token: command.auth_token,
    });
    console.log(`config.set: ok path=${configPath}`);
    return 0;
  }

  if (command.kind === "identity_show" || command.kind === "identity_init") {
    const identityPath = resolveOperatorDeviceIdentityPath(tyrumHome);
    const storage = createNodeFileDeviceIdentityStorage(identityPath);
    try {
      const identity = await loadOrCreateDeviceIdentity(storage);
      console.log(`identity: ok device_id=${identity.deviceId} path=${identityPath}`);
      return 0;
    } catch (error) {
      console.error(`identity: failed: ${formatDeviceIdentityError(error)}`);
      return 1;
    }
  }

  return 1;
}
