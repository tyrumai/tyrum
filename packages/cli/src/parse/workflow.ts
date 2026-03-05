import type { ActionPrimitive } from "@tyrum/client";

import {
  WORKFLOW_LANES,
  isWorkflowLane,
  type CliCommand,
  type WorkflowLane,
} from "../cli-command.js";

import { parseNonEmptyString } from "./common.js";

export function parseWorkflowCommand(argv: readonly string[]): CliCommand {
  const second = argv[1];
  if (second === "-h" || second === "--help") return { kind: "help" };
  if (!second) {
    throw new Error("workflow requires a subcommand (run|resume|cancel)");
  }

  if (second === "run") return parseWorkflowRun(argv);
  if (second === "resume") return parseWorkflowResume(argv);
  if (second === "cancel") return parseWorkflowCancel(argv);

  throw new Error(`unknown workflow subcommand '${second}'`);
}

function parseWorkflowRun(argv: readonly string[]): CliCommand {
  let key: string | undefined;
  let lane: WorkflowLane = "main";
  let stepsRaw: string | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--key") {
      key = parseNonEmptyString(argv[i + 1], "--key");
      i += 1;
      continue;
    }

    if (arg === "--lane") {
      const trimmed = parseNonEmptyString(argv[i + 1], "--lane");
      if (!isWorkflowLane(trimmed)) {
        throw new Error(`--lane must be one of ${WORKFLOW_LANES.join(", ")}`);
      }
      lane = trimmed;
      i += 1;
      continue;
    }

    if (arg === "--steps") {
      stepsRaw = parseWorkflowStepsFlag(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) {
      throw new Error(`unsupported workflow.run argument '${arg}'`);
    }
    throw new Error(`unexpected workflow.run argument '${arg}'`);
  }

  if (!key) throw new Error("workflow run requires --key <key>");
  if (!stepsRaw) throw new Error("workflow run requires --steps <json>");

  const parsedSteps = parseWorkflowSteps(stepsRaw);
  if (parsedSteps.length === 0) {
    throw new Error("--steps must be a non-empty JSON array");
  }

  return { kind: "workflow_run", key, lane, steps: parsedSteps };
}

function parseWorkflowStepsFlag(raw: string | undefined): string {
  if (!raw) throw new Error("--steps requires a value");
  return raw;
}

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

function parseWorkflowResume(argv: readonly string[]): CliCommand {
  let token: string | undefined;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--token") {
      token = parseNonEmptyString(argv[i + 1], "--token");
      i += 1;
      continue;
    }

    if (arg === "-h" || arg === "--help") return { kind: "help" };

    if (arg.startsWith("-")) {
      throw new Error(`unsupported workflow.resume argument '${arg}'`);
    }
    throw new Error(`unexpected workflow.resume argument '${arg}'`);
  }

  if (!token) throw new Error("workflow resume requires --token <resume-token>");
  return { kind: "workflow_resume", token };
}

function parseWorkflowCancel(argv: readonly string[]): CliCommand {
  let runId: string | undefined;
  let reason: string | undefined;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--run-id") {
      runId = parseNonEmptyString(argv[i + 1], "--run-id");
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
      throw new Error(`unsupported workflow.cancel argument '${arg}'`);
    }
    throw new Error(`unexpected workflow.cancel argument '${arg}'`);
  }

  if (!runId) throw new Error("workflow cancel requires --run-id <run-id>");
  return { kind: "workflow_cancel", run_id: runId, reason };
}
