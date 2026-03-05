import type { CliCommand } from "../cli-command.js";

import { parseNonEmptyString, parsePositiveInt } from "./common.js";

type PairingSubcommand = "approve" | "deny" | "revoke";

export function parsePairingCommand(argv: readonly string[]): CliCommand {
  const second = argv[1];
  if (second === "-h" || second === "--help") return { kind: "help" };
  if (!second) throw new Error("pairing requires a subcommand (approve|deny|revoke)");

  const parsePairingId = (raw: string | undefined, flag: string): number => {
    return parsePositiveInt(raw, flag);
  };

  if (second === "approve") return parsePairingApprove(argv, parsePairingId);
  if (second === "deny" || second === "revoke") {
    return parsePairingDenyOrRevoke(argv, second, parsePairingId);
  }

  throw new Error(`unknown pairing subcommand '${second}'`);
}

function parsePairingApprove(
  argv: readonly string[],
  parsePairingId: (raw: string | undefined, flag: string) => number,
): CliCommand {
  let pairingId: number | undefined;
  let trustLevel: "local" | "remote" | undefined;
  const capabilities: Array<{ id: string; version: string }> = [];
  let reason: string | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--pairing-id") {
      pairingId = parsePairingId(argv[i + 1], "--pairing-id");
      i += 1;
      continue;
    }

    if (arg === "--trust-level") {
      const raw = argv[i + 1]?.trim();
      if (!raw) throw new Error("--trust-level requires a value");
      if (raw !== "local" && raw !== "remote") {
        throw new Error("--trust-level must be 'local' or 'remote'");
      }
      trustLevel = raw;
      i += 1;
      continue;
    }

    if (arg === "--capability") {
      const raw = argv[i + 1];
      if (!raw) throw new Error("--capability requires a value");
      const trimmed = raw.trim();
      if (!trimmed) throw new Error("--capability requires a non-empty value");
      const [id, versionRaw] = trimmed.split("@", 2);
      const capabilityId = id?.trim() ?? "";
      const version = (versionRaw?.trim() || "1.0.0") as string;
      if (!capabilityId) throw new Error("--capability requires a non-empty id");
      if (!version) throw new Error("--capability version must be non-empty");
      capabilities.push({ id: capabilityId, version });
      i += 1;
      continue;
    }

    if (arg === "--reason") {
      reason = parseNonEmptyString(argv[i + 1], "--reason");
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) {
      throw new Error(`unsupported pairing.approve argument '${arg}'`);
    }
    throw new Error(`unexpected pairing.approve argument '${arg}'`);
  }

  if (!pairingId) throw new Error("pairing approve requires --pairing-id <id>");
  if (!trustLevel) throw new Error("pairing approve requires --trust-level <local|remote>");
  if (capabilities.length === 0) {
    throw new Error("pairing approve requires at least one --capability <id[@version]>");
  }

  return {
    kind: "pairing_approve",
    pairing_id: pairingId,
    trust_level: trustLevel,
    capability_allowlist: capabilities,
    reason,
  };
}

function parsePairingDenyOrRevoke(
  argv: readonly string[],
  second: PairingSubcommand,
  parsePairingId: (raw: string | undefined, flag: string) => number,
): CliCommand {
  let pairingId: number | undefined;
  let reason: string | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--pairing-id") {
      pairingId = parsePairingId(argv[i + 1], "--pairing-id");
      i += 1;
      continue;
    }

    if (arg === "--reason") {
      reason = parseNonEmptyString(argv[i + 1], "--reason");
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) {
      throw new Error(`unsupported pairing.${second} argument '${arg}'`);
    }
    throw new Error(`unexpected pairing.${second} argument '${arg}'`);
  }

  if (!pairingId) throw new Error(`pairing ${second} requires --pairing-id <id>`);
  if (second === "deny") return { kind: "pairing_deny", pairing_id: pairingId, reason };
  return { kind: "pairing_revoke", pairing_id: pairingId, reason };
}
