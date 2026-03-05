import type { CliCommand } from "../cli-command.js";
import { runOperatorHttpCommand } from "../operator-clients.js";

export async function handlePairingApprove(
  command: Extract<CliCommand, { kind: "pairing_approve" }>,
  home: string,
): Promise<number> {
  return await runOperatorHttpCommand(home, "pairing", async (http) => {
    return await http.pairings.approve(command.pairing_id, {
      trust_level: command.trust_level,
      capability_allowlist: command.capability_allowlist,
      reason: command.reason,
    });
  });
}

export async function handlePairingDeny(
  command: Extract<CliCommand, { kind: "pairing_deny" }>,
  home: string,
): Promise<number> {
  return await runOperatorHttpCommand(home, "pairing", async (http) => {
    return await http.pairings.deny(command.pairing_id, { reason: command.reason });
  });
}

export async function handlePairingRevoke(
  command: Extract<CliCommand, { kind: "pairing_revoke" }>,
  home: string,
): Promise<number> {
  return await runOperatorHttpCommand(home, "pairing", async (http) => {
    return await http.pairings.revoke(command.pairing_id, { reason: command.reason });
  });
}
