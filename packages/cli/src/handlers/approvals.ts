import type { CliCommand } from "../cli-command.js";
import { runOperatorWsCommand } from "../operator-clients.js";

export async function handleApprovalsList(
  command: Extract<CliCommand, { kind: "approvals_list" }>,
  home: string,
): Promise<number> {
  return await runOperatorWsCommand(home, "approvals.list", async (client) => {
    return await client.approvalList({ limit: command.limit });
  });
}

export async function handleApprovalsResolve(
  command: Extract<CliCommand, { kind: "approvals_resolve" }>,
  home: string,
): Promise<number> {
  return await runOperatorWsCommand(home, "approvals.resolve", async (client) => {
    return await client.approvalResolve({
      approval_id: command.approval_id,
      decision: command.decision,
      reason: command.reason,
    });
  });
}
