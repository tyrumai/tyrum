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

describe("Playbook LLM step executor", () => {
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

  it("fails when tool-call limit is exceeded", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-llm-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const languageModel = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "tc-1",
            toolName: "bash",
            input: JSON.stringify({ command: "echo one" }),
          },
          {
            type: "tool-call" as const,
            toolCallId: "tc-2",
            toolName: "bash",
            input: JSON.stringify({ command: "echo two" }),
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: usage(),
        warnings: [],
      }),
    });

    const engine = new ExecutionEngine({ db: container.db });

    const { runId } = await engine.enqueuePlan({
      tenantId: DEFAULT_TENANT_ID,
      key: "test",
      planId: "plan-llm-tool-limit",
      requestId: "req-1",
      steps: [
        {
          type: "Llm",
          args: {
            model: "openai/gpt-4.1",
            prompt: "Run two commands.",
            max_tool_calls: 1,
            tools: { allow: ["bash"] },
            __playbook: { output: { type: "json", schema: { type: "object" } } },
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
        execute: async () => ({
          success: true,
          result: { ok: true },
          evidence: { json: { ok: true } },
        }),
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

    const err = await container.db.get<{ error: string | null }>(
      `SELECT a.error
       FROM execution_attempts a
       JOIN execution_steps s ON s.step_id = a.step_id
       WHERE s.turn_id = ?
       ORDER BY a.started_at DESC
       LIMIT 1`,
      [runId],
    );
    expect(err?.error ?? "").toContain("tool-call limit");
  });

  it("pauses when policy requires approval for an LLM tool call", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-llm-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const policySnapshotId = "550e8400-e29b-41d4-a716-446655440010";
    await container.db.run(
      "INSERT INTO policy_snapshots (tenant_id, policy_snapshot_id, sha256, bundle_json) VALUES (?, ?, ?, ?)",
      [
        DEFAULT_TENANT_ID,
        policySnapshotId,
        "sha-test",
        JSON.stringify({
          v: 1,
          tools: {
            default: "allow",
            allow: [],
            require_approval: ["bash"],
            deny: [],
          },
          network_egress: { default: "allow", allow: [], require_approval: [], deny: [] },
          secrets: { default: "allow", allow: [], require_approval: [], deny: [] },
        }),
      ],
    );

    const languageModel = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "tc-1",
            toolName: "bash",
            input: JSON.stringify({ command: "echo one" }),
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: usage(),
        warnings: [],
      }),
    });

    const engine = new ExecutionEngine({ db: container.db });

    const { runId } = await engine.enqueuePlan({
      tenantId: DEFAULT_TENANT_ID,
      key: "test",
      planId: "plan-llm-policy-approval",
      requestId: "req-1",
      policySnapshotId,
      steps: [
        {
          type: "Llm",
          args: {
            model: "openai/gpt-4.1",
            prompt: "Run one command.",
            max_tool_calls: 5,
            tools: { allow: ["bash"] },
            __playbook: { output: { type: "json", schema: { type: "object" } } },
          },
        },
      ],
    });

    let toolCalls = 0;
    const executor = createGatewayStepExecutor({
      container,
      languageModel,
      toolExecutor: {
        execute: async () => {
          toolCalls += 1;
          return { success: true, result: { ok: true }, evidence: { json: { ok: true } } };
        },
      },
    });

    for (let i = 0; i < 5; i += 1) {
      await engine.workerTick({ workerId: "w1", executor, runId });
    }

    const run = await container.db.get<{ status: string }>(
      "SELECT status FROM turns WHERE turn_id = ?",
      [runId],
    );
    expect(run?.status).toBe("paused");
    expect(toolCalls).toBe(0);

    const approval = await container.db.get<{ prompt: string; status: string }>(
      "SELECT prompt, status FROM approvals WHERE turn_id = ? ORDER BY created_at DESC LIMIT 1",
      [runId],
    );
    expect(approval?.status).toBe("queued");
    expect(approval?.prompt ?? "").toContain("Policy approval required");
  });

  it("pauses when policy requires approval for HTTP fetch tool calls", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-llm-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const policySnapshotId = "6f9619ff-8b86-4d11-b42d-00c04fc96410";
    await container.db.run(
      "INSERT INTO policy_snapshots (tenant_id, policy_snapshot_id, sha256, bundle_json) VALUES (?, ?, ?, ?)",
      [
        DEFAULT_TENANT_ID,
        policySnapshotId,
        "sha-http-test",
        JSON.stringify({
          v: 1,
          tools: {
            default: "allow",
            allow: [],
            require_approval: ["webfetch"],
            deny: [],
          },
          network_egress: { default: "allow", allow: [], require_approval: [], deny: [] },
          secrets: { default: "allow", allow: [], require_approval: [], deny: [] },
        }),
      ],
    );

    const languageModel = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "tc-http-1",
            toolName: "webfetch",
            input: JSON.stringify({ url: "https://example.com" }),
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: usage(),
        warnings: [],
      }),
    });

    const engine = new ExecutionEngine({ db: container.db });

    const { runId } = await engine.enqueuePlan({
      tenantId: DEFAULT_TENANT_ID,
      key: "test",
      planId: "plan-llm-policy-approval-http",
      requestId: "req-1",
      policySnapshotId,
      steps: [
        {
          type: "Llm",
          args: {
            model: "openai/gpt-4.1",
            prompt: "Fetch https://example.com.",
            max_tool_calls: 5,
            tools: { allow: ["webfetch"] },
            __playbook: { output: { type: "json", schema: { type: "object" } } },
          },
        },
      ],
    });

    let toolCalls = 0;
    const executor = createGatewayStepExecutor({
      container,
      languageModel,
      toolExecutor: {
        execute: async () => {
          toolCalls += 1;
          return { success: true, result: { ok: true }, evidence: { json: { ok: true } } };
        },
      },
    });

    for (let i = 0; i < 5; i += 1) {
      await engine.workerTick({ workerId: "w1", executor, runId });
    }

    const run = await container.db.get<{ status: string }>(
      "SELECT status FROM turns WHERE turn_id = ?",
      [runId],
    );
    expect(run?.status).toBe("paused");
    expect(toolCalls).toBe(0);

    const approval = await container.db.get<{ prompt: string; status: string }>(
      "SELECT prompt, status FROM approvals WHERE turn_id = ? ORDER BY created_at DESC LIMIT 1",
      [runId],
    );
    expect(approval?.status).toBe("queued");
    expect(approval?.prompt ?? "").toContain("Policy approval required");
  });

  it("succeeds when JSON output matches schema", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-llm-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const languageModel = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: usage(),
        warnings: [],
      }),
    });

    const engine = new ExecutionEngine({ db: container.db });

    const { runId } = await engine.enqueuePlan({
      tenantId: DEFAULT_TENANT_ID,
      key: "test",
      planId: "plan-llm-schema-pass",
      requestId: "req-1",
      steps: [
        {
          type: "Llm",
          args: {
            model: "openai/gpt-4.1",
            prompt: "Return a JSON object with { ok: true }.",
            max_tool_calls: 0,
            tools: { allow: [] },
            __playbook: {
              output: {
                type: "json",
                schema: {
                  type: "object",
                  properties: { ok: { type: "boolean" } },
                  required: ["ok"],
                  additionalProperties: false,
                },
              },
            },
          },
        },
      ],
    });

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
    expect(run?.status).toBe("succeeded");

    const attempt = await container.db.get<{ status: string; metadata_json: string | null }>(
      `SELECT a.status, a.metadata_json
       FROM execution_attempts a
       JOIN execution_steps s ON s.step_id = a.step_id
       WHERE s.turn_id = ?
       ORDER BY a.started_at DESC
       LIMIT 1`,
      [runId],
    );
    expect(attempt?.status).toBe("succeeded");
    const meta = JSON.parse(attempt?.metadata_json ?? "{}") as { json?: unknown };
    expect(meta.json).toEqual({ ok: true });
  });

  it("fails when JSON output violates schema", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-llm-"));
    container = await createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const languageModel = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text" as const, text: JSON.stringify([]) }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: usage(),
        warnings: [],
      }),
    });

    const engine = new ExecutionEngine({ db: container.db });

    const { runId } = await engine.enqueuePlan({
      tenantId: DEFAULT_TENANT_ID,
      key: "test",
      planId: "plan-llm-schema-fail",
      requestId: "req-1",
      steps: [
        {
          type: "Llm",
          args: {
            model: "openai/gpt-4.1",
            prompt: "Return JSON.",
            max_tool_calls: 0,
            tools: { allow: [] },
            __playbook: {
              output: {
                type: "json",
                schema: {
                  type: "object",
                  properties: { ok: { type: "boolean" } },
                  required: ["ok"],
                  additionalProperties: false,
                },
              },
            },
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

    const err = await container.db.get<{ error: string | null; metadata_json: string | null }>(
      `SELECT a.error, a.metadata_json
       FROM execution_attempts a
       JOIN execution_steps s ON s.step_id = a.step_id
       WHERE s.turn_id = ?
       ORDER BY a.started_at DESC
       LIMIT 1`,
      [runId],
    );
    expect(err?.error ?? "").toContain("schema validation");
    const meta = JSON.parse(err?.metadata_json ?? "{}") as { json?: unknown };
    expect(meta.json).toEqual([]);
  });
});
