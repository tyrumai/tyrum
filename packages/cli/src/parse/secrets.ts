import type { CliCommand } from "../cli-command.js";

import { parseElevatedToken, parseNonEmptyString, parseRequiredValue } from "./common.js";

export function parseSecretsCommand(argv: readonly string[]): CliCommand {
  const second = argv[1];
  if (second === "-h" || second === "--help") return { kind: "help" };
  if (!second) throw new Error("secrets requires a subcommand (store|list|revoke|rotate)");

  if (second === "list") return parseSecretsList(argv);
  if (second === "store") return parseSecretsStore(argv);
  if (second === "revoke" || second === "rotate") return parseSecretsRevokeOrRotate(argv, second);

  throw new Error(`unknown secrets subcommand '${second}'`);
}

function parseSecretsList(argv: readonly string[]): CliCommand {
  let elevatedToken: string | undefined;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--elevated-token") {
      elevatedToken = parseElevatedToken(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };
    if (arg.startsWith("-")) throw new Error(`unsupported secrets.list argument '${arg}'`);
    throw new Error(`unexpected secrets.list argument '${arg}'`);
  }
  return { kind: "secrets_list", elevated_token: elevatedToken };
}

function parseSecretsStore(argv: readonly string[]): CliCommand {
  let elevatedToken: string | undefined;
  let secretKey: string | undefined;
  let value: string | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--elevated-token") {
      elevatedToken = parseElevatedToken(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === "--secret-key") {
      secretKey = parseNonEmptyString(argv[i + 1], "--secret-key");
      i += 1;
      continue;
    }

    if (arg === "--value") {
      value = parseRequiredValue(argv[i + 1], "--value");
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) throw new Error(`unsupported secrets.store argument '${arg}'`);
    throw new Error(`unexpected secrets.store argument '${arg}'`);
  }

  if (!secretKey) throw new Error("secrets store requires --secret-key <secret_key>");
  if (!value) throw new Error("secrets store requires --value <value>");
  return { kind: "secrets_store", elevated_token: elevatedToken, secret_key: secretKey, value };
}

function parseSecretsRevokeOrRotate(
  argv: readonly string[],
  second: "revoke" | "rotate",
): CliCommand {
  let elevatedToken: string | undefined;
  let handleId: string | undefined;
  let value: string | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--elevated-token") {
      elevatedToken = parseElevatedToken(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === "--handle-id") {
      handleId = parseNonEmptyString(argv[i + 1], "--handle-id");
      i += 1;
      continue;
    }

    if (arg === "--value") {
      if (second === "revoke") {
        throw new Error(
          "secrets revoke does not accept --value (did you mean 'tyrum-cli secrets rotate'?)",
        );
      }
      value = parseRequiredValue(argv[i + 1], "--value");
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) throw new Error(`unsupported secrets.${second} argument '${arg}'`);
    throw new Error(`unexpected secrets.${second} argument '${arg}'`);
  }

  if (!handleId) throw new Error(`secrets ${second} requires --handle-id <handle-id>`);

  if (second === "revoke") {
    return { kind: "secrets_revoke", elevated_token: elevatedToken, handle_id: handleId };
  }

  if (!value) throw new Error("secrets rotate requires --value <value>");
  return { kind: "secrets_rotate", elevated_token: elevatedToken, handle_id: handleId, value };
}
