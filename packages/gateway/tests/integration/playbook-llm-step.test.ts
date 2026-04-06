import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { MockLanguageModelV3 } from "ai/test";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { createGatewayStepExecutor } from "../../src/modules/execution/gateway-step-executor.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
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

    const workflowRunId = await enqueueWorkflowRunForTest(container, {
      runKey: "test",
      planId: "plan-llm-tool-limit",
      requestId: "req-1",
      actions: [
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
        execute: async () => ({
          success: true,
          result: { ok: true },
          evidence: { json: { ok: true } },
        }),
      },
    });

    await tickWorkflowRunUntilSettled(container, { workflowRunId, executor, maxTicks: 5 });

    const run = await container.db.get<{ status: string }>(
      "SELECT status FROM workflow_runs WHERE workflow_run_id = ?",
      [workflowRunId],
    );
    expect(run?.status).toBe("failed");

    const step = await container.db.get<{ error: string | null }>(
      `SELECT error
       FROM workflow_run_steps
       WHERE workflow_run_id = ?
       ORDER BY step_index DESC
       LIMIT 1`,
      [workflowRunId],
    );
    expect(step?.error ?? "").toContain("tool-call limit");
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

    const workflowRunId = await enqueueWorkflowRunForTest(container, {
      runKey: "test",
      planId: "plan-llm-policy-approval",
      requestId: "req-1",
      policySnapshotId,
      actions: [
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

    await tickWorkflowRunUntilSettled(container, { workflowRunId, executor, maxTicks: 5 });

    const run = await container.db.get<{ status: string }>(
      "SELECT status FROM workflow_runs WHERE workflow_run_id = ?",
      [workflowRunId],
    );
    expect(run?.status).toBe("paused");
    expect(toolCalls).toBe(0);

    const approval = await container.db.get<{ prompt: string; status: string }>(
      `SELECT approvals.prompt, approvals.status
       FROM approvals
       JOIN workflow_run_steps
         ON workflow_run_steps.tenant_id = approvals.tenant_id
        AND workflow_run_steps.workflow_run_step_id = approvals.workflow_run_step_id
       WHERE workflow_run_steps.workflow_run_id = ?
       ORDER BY approvals.created_at DESC
       LIMIT 1`,
      [workflowRunId],
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

    const workflowRunId = await enqueueWorkflowRunForTest(container, {
      runKey: "test",
      planId: "plan-llm-policy-approval-http",
      requestId: "req-1",
      policySnapshotId,
      actions: [
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

    await tickWorkflowRunUntilSettled(container, { workflowRunId, executor, maxTicks: 5 });

    const run = await container.db.get<{ status: string }>(
      "SELECT status FROM workflow_runs WHERE workflow_run_id = ?",
      [workflowRunId],
    );
    expect(run?.status).toBe("paused");
    expect(toolCalls).toBe(0);

    const approval = await container.db.get<{ prompt: string; status: string }>(
      `SELECT approvals.prompt, approvals.status
       FROM approvals
       JOIN workflow_run_steps
         ON workflow_run_steps.tenant_id = approvals.tenant_id
        AND workflow_run_steps.workflow_run_step_id = approvals.workflow_run_step_id
       WHERE workflow_run_steps.workflow_run_id = ?
       ORDER BY approvals.created_at DESC
       LIMIT 1`,
      [workflowRunId],
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

    const workflowRunId = await enqueueWorkflowRunForTest(container, {
      runKey: "test",
      planId: "plan-llm-schema-pass",
      requestId: "req-1",
      actions: [
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

    await tickWorkflowRunUntilSettled(container, { workflowRunId, executor, maxTicks: 5 });

    const run = await container.db.get<{ status: string }>(
      "SELECT status FROM workflow_runs WHERE workflow_run_id = ?",
      [workflowRunId],
    );
    expect(run?.status).toBe("succeeded");

    const step = await container.db.get<{ status: string; metadata_json: string | null }>(
      `SELECT status, metadata_json
       FROM workflow_run_steps
       WHERE workflow_run_id = ?
       ORDER BY step_index DESC
       LIMIT 1`,
      [workflowRunId],
    );
    expect(step?.status).toBe("succeeded");
    const meta = JSON.parse(step?.metadata_json ?? "{}") as { json?: unknown };
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

    const workflowRunId = await enqueueWorkflowRunForTest(container, {
      runKey: "test",
      planId: "plan-llm-schema-fail",
      requestId: "req-1",
      actions: [
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
    expect(step?.error ?? "").toContain("schema validation");
    const meta = JSON.parse(step?.metadata_json ?? "{}") as { json?: unknown };
    expect(meta.json).toEqual([]);
  });
});
