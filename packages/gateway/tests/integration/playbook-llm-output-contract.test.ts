import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { MockLanguageModelV3 } from "ai/test";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { createGatewayStepExecutor } from "../../src/modules/execution/gateway-step-executor.js";
import {
  enqueueWorkflowRunForTest,
  tickWorkflowRunUntilSettled,
} from "../helpers/workflow-run-support.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function usage() {
  return {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 5,
      text: 5,
      reasoning: undefined,
    },
  };
}

describe("Playbook LLM output contracts", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("fails when a JSON output contract is declared but the model returns text", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-llm-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const languageModel = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text" as const, text: "not-json" }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: usage(),
        warnings: [],
      }),
    });

    const workflowRunId = await enqueueWorkflowRunForTest(container, {
      runKey: "test",
      planId: "plan-llm-json-contract-fail",
      requestId: "req-1",
      actions: [
        {
          type: "Llm",
          args: {
            model: "openai/gpt-4.1",
            prompt: "Return JSON.",
            max_tool_calls: 0,
            tools: { allow: [] },
            __playbook: { output: "json" },
          },
        },
      ],
    });

    await container.db.run(
      `UPDATE workflow_run_steps
       SET max_attempts = 1
       WHERE workflow_run_id = ?`,
      [workflowRunId],
    );

    const executor = createGatewayStepExecutor({
      container,
      languageModel,
      toolExecutor: {
        execute: async () => ({ success: false, error: "tool execution should not run" }),
      },
    });

    await tickWorkflowRunUntilSettled(container, { workflowRunId, executor, maxTicks: 5 });

    const run = await container.db.get<{ status: string }>(
      "SELECT status FROM workflow_runs WHERE workflow_run_id = ?",
      [workflowRunId],
    );
    expect(run?.status).toBe("failed");

    const step = await container.db.get<{ error: string | null; metadata_json: string | null }>(
      `SELECT error, metadata_json
       FROM workflow_run_steps
       WHERE workflow_run_id = ?
       ORDER BY step_index DESC
       LIMIT 1`,
      [workflowRunId],
    );
    expect(step?.error ?? "").toContain("expected JSON");
    const meta = JSON.parse(step?.metadata_json ?? "{}") as { json?: unknown };
    expect(meta.json).toBeUndefined();
  });
});
