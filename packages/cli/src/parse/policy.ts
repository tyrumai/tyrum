import type { CliCommand } from "../cli-command.js";

import { parseElevatedToken, parseNonEmptyString } from "./common.js";

export function parsePolicyCommand(argv: readonly string[]): CliCommand {
  const second = argv[1];
  if (second === "-h" || second === "--help") return { kind: "help" };
  if (!second) throw new Error("policy requires a subcommand (bundle|overrides)");

  if (second === "bundle") return parsePolicyBundle(argv);
  if (second === "overrides") return parsePolicyOverrides(argv);

  throw new Error(`unknown policy subcommand '${second}'`);
}

function parsePolicyBundle(argv: readonly string[]): CliCommand {
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
    if (arg.startsWith("-")) throw new Error(`unsupported policy.bundle argument '${arg}'`);
    throw new Error(`unexpected policy.bundle argument '${arg}'`);
  }
  return { kind: "policy_bundle", elevated_token: elevatedToken };
}

function parsePolicyOverrides(argv: readonly string[]): CliCommand {
  const third = argv[2];
  if (third === "-h" || third === "--help") return { kind: "help" };
  if (!third) throw new Error("policy overrides requires a subcommand (list|create|revoke)");

  if (third === "list") return parsePolicyOverridesList(argv);
  if (third === "create") return parsePolicyOverridesCreate(argv);
  if (third === "revoke") return parsePolicyOverridesRevoke(argv);

  throw new Error(`unknown policy overrides subcommand '${third}'`);
}

function parsePolicyOverridesList(argv: readonly string[]): CliCommand {
  let elevatedToken: string | undefined;
  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--elevated-token") {
      elevatedToken = parseElevatedToken(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };
    if (arg.startsWith("-")) {
      throw new Error(`unsupported policy.overrides.list argument '${arg}'`);
    }
    throw new Error(`unexpected policy.overrides.list argument '${arg}'`);
  }
  return { kind: "policy_overrides_list", elevated_token: elevatedToken };
}

function parsePolicyOverridesCreate(argv: readonly string[]): CliCommand {
  let elevatedToken: string | undefined;
  let agentId: string | undefined;
  let toolId: string | undefined;
  let pattern: string | undefined;
  let workspaceId: string | undefined;

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--elevated-token") {
      elevatedToken = parseElevatedToken(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === "--agent-id") {
      agentId = parseNonEmptyString(argv[i + 1], "--agent-id");
      i += 1;
      continue;
    }

    if (arg === "--tool-id") {
      toolId = parseNonEmptyString(argv[i + 1], "--tool-id");
      i += 1;
      continue;
    }

    if (arg === "--pattern") {
      pattern = parseNonEmptyString(argv[i + 1], "--pattern");
      i += 1;
      continue;
    }

    if (arg === "--workspace-id") {
      workspaceId = parseNonEmptyString(argv[i + 1], "--workspace-id");
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) {
      throw new Error(`unsupported policy.overrides.create argument '${arg}'`);
    }
    throw new Error(`unexpected policy.overrides.create argument '${arg}'`);
  }

  if (!agentId) throw new Error("policy overrides create requires --agent-id <agent-id>");
  if (!toolId) throw new Error("policy overrides create requires --tool-id <tool-id>");
  if (!pattern) throw new Error("policy overrides create requires --pattern <glob>");

  return {
    kind: "policy_overrides_create",
    elevated_token: elevatedToken,
    agent_id: agentId,
    tool_id: toolId,
    pattern,
    workspace_id: workspaceId,
  };
}

function parsePolicyOverridesRevoke(argv: readonly string[]): CliCommand {
  let elevatedToken: string | undefined;
  let id: string | undefined;
  let reason: string | undefined;

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--elevated-token") {
      elevatedToken = parseElevatedToken(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === "--policy-override-id") {
      id = parseNonEmptyString(argv[i + 1], "--policy-override-id");
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
      throw new Error(`unsupported policy.overrides.revoke argument '${arg}'`);
    }
    throw new Error(`unexpected policy.overrides.revoke argument '${arg}'`);
  }

  if (!id) throw new Error("policy overrides revoke requires --policy-override-id <id>");
  return {
    kind: "policy_overrides_revoke",
    elevated_token: elevatedToken,
    policy_override_id: id,
    reason,
  };
}
