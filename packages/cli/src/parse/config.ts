import { normalizeFingerprint256 } from "@tyrum/client/node";

import type { CliCommand } from "../cli-command.js";

export function parseConfigCommand(argv: readonly string[]): CliCommand {
  const second = argv[1];
  if (second === "-h" || second === "--help") return { kind: "help" };
  if (!second || second === "show") {
    for (let i = 2; i < argv.length; i += 1) {
      const arg = argv[i];
      if (!arg) continue;
      if (arg === "-h" || arg === "--help") return { kind: "help" };
      if (arg.startsWith("-")) {
        throw new Error(`unsupported config.show argument '${arg}'`);
      }
      throw new Error(`unexpected config.show argument '${arg}'`);
    }
    return { kind: "config_show" };
  }
  if (second !== "set") {
    throw new Error(`unknown config subcommand '${second}'`);
  }

  return parseConfigSet(argv);
}

function parseConfigSet(argv: readonly string[]): CliCommand {
  let gatewayUrl: string | undefined;
  let token: string | undefined;
  let tlsFingerprint256: string | undefined;
  let tlsAllowSelfSigned = false;
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

    if (arg === "--tls-fingerprint256") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--tls-fingerprint256 requires a value");
      }
      tlsFingerprint256 = value;
      i += 1;
      continue;
    }

    if (arg === "--tls-allow-self-signed") {
      tlsAllowSelfSigned = true;
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

  const tlsCertFingerprint256Raw = tlsFingerprint256?.trim() ?? "";
  const tlsCertFingerprint256 =
    tlsCertFingerprint256Raw.length > 0 ? normalizeFingerprint256(tlsCertFingerprint256Raw) : null;
  if (tlsCertFingerprint256Raw && !tlsCertFingerprint256) {
    throw new Error("--tls-fingerprint256 must be a SHA-256 hex fingerprint");
  }
  if (tlsAllowSelfSigned && !tlsCertFingerprint256) {
    throw new Error("--tls-allow-self-signed requires --tls-fingerprint256");
  }

  return {
    kind: "config_set",
    gateway_url: normalizedGatewayUrl,
    auth_token: normalizedToken,
    ...(tlsCertFingerprint256 ? { tls_cert_fingerprint256: tlsCertFingerprint256 } : {}),
    ...(tlsAllowSelfSigned ? { tls_allow_self_signed: true } : {}),
  };
}
