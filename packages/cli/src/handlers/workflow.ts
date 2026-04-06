import type { CliCommand } from "../cli-command.js";
import { runOperatorWsCommand } from "../operator-clients.js";

export async function handleWorkflowStart(
  command: Extract<CliCommand, { kind: "workflow_start" }>,
  home: string,
): Promise<number> {
  return await runOperatorWsCommand(home, "workflow.start", async (client) => {
    return await client.workflowStart({
      conversation_key: command.conversation_key,
      steps: command.steps,
    });
  });
}

export async function handleWorkflowResume(
  command: Extract<CliCommand, { kind: "workflow_resume" }>,
  home: string,
): Promise<number> {
  return await runOperatorWsCommand(home, "workflow.resume", async (client) => {
    return await client.workflowResume({ token: command.token });
  });
}

export async function handleWorkflowCancel(
  command: Extract<CliCommand, { kind: "workflow_cancel" }>,
  home: string,
): Promise<number> {
  return await runOperatorWsCommand(home, "workflow.cancel", async (client) => {
    return await client.workflowCancel({
      workflow_run_id: command.workflow_run_id,
      reason: command.reason,
    });
  });
}
