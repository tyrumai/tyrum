import type { CliCommand } from "../cli-command.js";
import { runOperatorWsCommand } from "../operator-clients.js";

export async function handleWorkflowRun(
  command: Extract<CliCommand, { kind: "workflow_run" }>,
  home: string,
): Promise<number> {
  return await runOperatorWsCommand(home, "workflow.run", async (client) => {
    return await client.workflowRun({
      key: command.key,
      lane: command.lane,
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
    return await client.workflowCancel({ run_id: command.run_id, reason: command.reason });
  });
}
