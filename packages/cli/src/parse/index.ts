import type { CliCommand } from "../cli-command.js";

import { parseApprovalsCommand } from "./approvals.js";
import { parseConfigCommand } from "./config.js";
import { parseElevatedModeCommand } from "./elevated-mode.js";
import { parseIdentityCommand } from "./identity.js";
import { parsePairingCommand } from "./pairing.js";
import { parsePolicyCommand } from "./policy.js";
import { parseSecretsCommand } from "./secrets.js";
import { parseWorkflowCommand } from "./workflow.js";

export function parseCliArgs(argv: readonly string[]): CliCommand {
  if (argv.length === 0) return { kind: "help" };

  const [first] = argv;
  if (first === "-h" || first === "--help") return { kind: "help" };
  if (first === "--version") return { kind: "version" };

  if (first === "pairing") return parsePairingCommand(argv);
  if (first === "secrets") return parseSecretsCommand(argv);
  if (first === "policy") return parsePolicyCommand(argv);
  if (first === "workflow") return parseWorkflowCommand(argv);
  if (first === "approvals") return parseApprovalsCommand(argv);
  if (first === "config") return parseConfigCommand(argv);
  if (first === "identity") return parseIdentityCommand(argv);
  if (first === "elevated-mode") return parseElevatedModeCommand(argv);

  throw new Error(`unknown command '${first}'`);
}
