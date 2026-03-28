import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { MockLanguageModelV3 } from "ai/test";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { createGatewayStepExecutor } from "../../src/modules/execution/gateway-step-executor.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

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

    const engine = new ExecutionEngine({ db: container.db });

    const { runId } = await engine.enqueuePlan({
      tenantId: DEFAULT_TENANT_ID,
      key: "test",
      planId: "plan-llm-json-contract-fail",
      requestId: "req-1",
      steps: [
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

    const stepRow = await container.db.get<{ step_id: string }>(
      "SELECT step_id FROM execution_steps WHERE turn_id = ? LIMIT 1",
      [runId],
    );
    await container.db.run("UPDATE execution_steps SET max_attempts = 1 WHERE step_id = ?", [
      stepRow?.step_id,
    ]);

    const executor = createGatewayStepExecutor({
      container,
      languageModel,
      toolExecutor: {
        execute: async () => ({ success: false, error: "tool execution should not run" }),
      },
    });

    for (let i = 0; i < 5; i += 1) {
      await engine.workerTick({ workerId: "w1", executor, runId });
    }

    const run = await container.db.get<{ status: string }>(
      "SELECT status FROM turns WHERE turn_id = ?",
      [runId],
    );
    expect(run?.status).toBe("failed");

    const attempt = await container.db.get<{ error: string | null; metadata_json: string | null }>(
      `SELECT a.error, a.metadata_json
       FROM execution_attempts a
       JOIN execution_steps s ON s.step_id = a.step_id
       WHERE s.turn_id = ?
       ORDER BY a.started_at DESC
       LIMIT 1`,
      [runId],
    );
    expect(attempt?.error ?? "").toContain("expected JSON");
    const meta = JSON.parse(attempt?.metadata_json ?? "{}") as { json?: unknown };
    expect(meta.json).toBeUndefined();
  });
});
