import { Command } from "commander";
import type { ActionPrimitive } from "@tyrum/contracts";
import type { CliCommand } from "../cli-command.js";

type SetResult = (command: CliCommand) => void;

function parseWorkflowSteps(stepsRaw: string): ActionPrimitive[] {
  let parsedSteps: unknown;
  try {
    parsedSteps = JSON.parse(stepsRaw) as unknown;
  } catch {
    throw new Error("--steps must be valid JSON");
  }
  if (!Array.isArray(parsedSteps)) {
    throw new Error("--steps must be a JSON array");
  }

  return parsedSteps.map((rawStep, idx) => {
    if (typeof rawStep !== "object" || rawStep === null || Array.isArray(rawStep)) {
      throw new Error(`--steps[${String(idx)}] must be an object`);
    }
    const record = rawStep as Record<string, unknown>;
    const rawType = record["type"];
    if (typeof rawType !== "string") {
      throw new Error(`--steps[${String(idx)}].type must be a string`);
    }
    const type = rawType.trim();
    if (!type) {
      throw new Error(`--steps[${String(idx)}].type must be a non-empty string`);
    }

    let args: Record<string, unknown> = {};
    const rawArgs = record["args"];
    if (rawArgs !== undefined) {
      if (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs)) {
        throw new Error(`--steps[${String(idx)}].args must be an object`);
      }
      args = rawArgs as Record<string, unknown>;
    }

    const rawKey = record["idempotency_key"];
    let idempotencyKey: string | undefined;
    if (rawKey !== undefined) {
      if (typeof rawKey !== "string") {
        throw new Error(`--steps[${String(idx)}].idempotency_key must be a string`);
      }
      const trimmed = rawKey.trim();
      if (!trimmed) {
        throw new Error(`--steps[${String(idx)}].idempotency_key must be a non-empty string`);
      }
      idempotencyKey = trimmed;
    }

    const step: ActionPrimitive & { postcondition?: unknown; idempotency_key?: string } = {
      type: type as ActionPrimitive["type"],
      args,
    };
    if (record["postcondition"] !== undefined) {
      step.postcondition = record["postcondition"];
    }
    if (idempotencyKey !== undefined) {
      step.idempotency_key = idempotencyKey;
    }
    return step;
  });
}

export function registerWorkflowCommand(input: {
  program: Command;
  setResult: SetResult;
  parseNonEmptyString: (raw: string | undefined, flag: string) => string;
  parseRequiredValue: (raw: string | undefined, flag: string) => string;
}): void {
  const workflowCommand = input.program.command("workflow");
  workflowCommand
    .command("start")
    .allowExcessArguments(false)
    .option("--conversation-key <key>")
    .option("--steps <json>")
    .action((options: { conversationKey?: string; steps?: string }) => {
      const conversationKey = input.parseNonEmptyString(
        options.conversationKey,
        "--conversation-key",
      );
      const stepsRaw = input.parseRequiredValue(options.steps, "--steps");
      const steps = parseWorkflowSteps(stepsRaw);
      if (steps.length === 0) {
        throw new Error("--steps must be a non-empty JSON array");
      }
      input.setResult({
        kind: "workflow_start",
        conversation_key: conversationKey,
        steps,
      });
    });

  workflowCommand
    .command("resume")
    .allowExcessArguments(false)
    .option("--token <token>")
    .action((options: { token?: string }) => {
      input.setResult({
        kind: "workflow_resume",
        token: input.parseNonEmptyString(options.token, "--token"),
      });
    });

  workflowCommand
    .command("cancel")
    .allowExcessArguments(false)
    .option("--workflow-run-id <id>")
    .option("--reason <text>")
    .action((options: { workflowRunId?: string; reason?: string }) => {
      input.setResult({
        kind: "workflow_cancel",
        workflow_run_id: input.parseNonEmptyString(options.workflowRunId, "--workflow-run-id"),
        reason: options.reason ? input.parseNonEmptyString(options.reason, "--reason") : undefined,
      });
    });
}
