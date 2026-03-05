import type { CliCommand } from "../cli-command.js";

import { parseNonEmptyString, parsePositiveInt } from "./common.js";

const approvalIdRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseApprovalsCommand(argv: readonly string[]): CliCommand {
  const second = argv[1];
  if (second === "-h" || second === "--help") return { kind: "help" };
  if (second && second !== "list" && second !== "resolve") {
    throw new Error(`unknown approvals subcommand '${second}'`);
  }

  if (!second || second === "list") {
    return parseApprovalsList(argv);
  }

  return parseApprovalsResolve(argv);
}

function parseApprovalsList(argv: readonly string[]): CliCommand {
  let limit = 100;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--limit") {
      limit = parsePositiveInt(argv[i + 1], "--limit");
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) {
      throw new Error(`unsupported approvals.list argument '${arg}'`);
    }
    throw new Error(`unexpected approvals.list argument '${arg}'`);
  }

  return { kind: "approvals_list", limit };
}

function parseApprovalsResolve(argv: readonly string[]): CliCommand {
  let approvalId: string | undefined;
  let decision: "approved" | "denied" | undefined;
  let reason: string | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--approval-id") {
      const trimmed = parseNonEmptyString(argv[i + 1], "--approval-id");
      if (!approvalIdRegex.test(trimmed)) {
        throw new Error("--approval-id must be a UUID");
      }
      approvalId = trimmed;
      i += 1;
      continue;
    }

    if (arg === "--decision") {
      const raw = argv[i + 1]?.trim();
      if (!raw) throw new Error("--decision requires a value");
      if (raw !== "approved" && raw !== "denied") {
        throw new Error("--decision must be 'approved' or 'denied'");
      }
      decision = raw;
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
      throw new Error(`unsupported approvals.resolve argument '${arg}'`);
    }
    throw new Error(`unexpected approvals.resolve argument '${arg}'`);
  }

  if (!approvalId) throw new Error("approvals resolve requires --approval-id <id>");
  if (!decision) throw new Error("approvals resolve requires --decision <approved|denied>");

  return { kind: "approvals_resolve", approval_id: approvalId, decision, reason };
}
