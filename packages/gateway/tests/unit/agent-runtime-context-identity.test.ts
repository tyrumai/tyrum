import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayContainer } from "../../src/container.js";
import { setupTestEnv, teardownTestEnv, fetch404, migrationsDir } from "./agent-runtime.test-helpers.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { createStubLanguageModel } from "./stub-language-model.js";

describe("AgentRuntime - context reports and identity keys", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await teardownTestEnv({ homeDir, container });
    container = undefined;
    homeDir = undefined;
  });

  it("reports system prompt section char counts as string lengths", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
      fetchImpl: fetch404,
    });

    await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello",
    });

    const report = runtime.getLastContextReport();
    expect(report).toBeDefined();

    const identitySection = report!.system_prompt.sections.find(
        (section) => section.id === "identity",
      ),
      safetySection = report!.system_prompt.sections.find((section) => section.id === "safety"),
      sandboxSection = report!.system_prompt.sections.find((section) => section.id === "sandbox");
    expect(identitySection).toBeDefined();
    expect(safetySection).toBeDefined();
    expect(sandboxSection).toBeDefined();

    const delimiter = "\n\n";
    expect(report!.system_prompt.chars).toBe(
      identitySection!.chars +
        delimiter.length +
        safetySection!.chars +
        delimiter.length +
        sandboxSection!.chars,
    );
  });

  it("rejects agentId containing ':'", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    expect(
      () =>
        new AgentRuntime({
          container,
          home: homeDir,
          agentId: "bad:agent",
          languageModel: createStubLanguageModel("hello"),
          fetchImpl: fetch404,
        }),
    ).toThrow(/invalid agent_id/i);
  });

  it("routes turns through execution engine run records", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("hello"),
      fetchImpl: fetch404,
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello from test",
    });

    expect(result.reply).toBe("hello");

    const run = await container.db.get<{
      run_id: string;
      status: string;
      key: string;
      lane: string;
    }>(
      `SELECT run_id, status, key, lane
       FROM execution_runs
       ORDER BY created_at DESC
       LIMIT 1`,
    );
    expect(run).toBeTruthy();
    expect(run!.status).toBe("succeeded");
    expect(run!.key).toBe("agent:default:test:default:channel:thread-1");
    expect(run!.lane).toBe("main");

    const step = await container.db.get<{ action_json: string }>(
      `SELECT action_json
       FROM execution_steps
       WHERE run_id = ?
       ORDER BY step_index ASC
       LIMIT 1`,
      [run!.run_id],
    );
    expect(step).toBeTruthy();
    const action = JSON.parse(step!.action_json) as {
      type: string;
      args: { message?: string };
    };
    expect(action.type).toBe("Decide");
    expect(action.args.message).toBe("hello from test");

    const attempt = await container.db.get<{ result_json: string | null }>(
      `SELECT a.result_json
       FROM execution_attempts a
       JOIN execution_steps s ON s.step_id = a.step_id
       WHERE s.run_id = ?
       ORDER BY a.attempt DESC
       LIMIT 1`,
      [run!.run_id],
    );
    expect(attempt).toBeTruthy();
    const attemptResult = JSON.parse(attempt!.result_json ?? "{}") as { reply?: string };
    expect(attemptResult.reply).toBe("hello");
  });

  it("persists workspace_id on execution jobs for agent turns", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      agentId: "agent-a",
      workspaceId: "agent-a",
      languageModel: createStubLanguageModel("hello"),
      fetchImpl: fetch404,
    });

    const result = await runtime.turn({
      channel: "test",
      thread_id: "thread-1",
      message: "hello from test",
    });
    expect(result.reply).toBe("hello");

    const run = await container.db.get<{ job_id: string }>(
      `SELECT job_id
       FROM execution_runs
       ORDER BY rowid DESC
       LIMIT 1`,
    );
    expect(run).toBeTruthy();

    const job = await container.db.get<{ workspace_id: string }>(
      "SELECT workspace_id FROM execution_jobs WHERE job_id = ?",
      [run!.job_id],
    );
    expect(job).toBeTruthy();
    const workspace = await container.db.get<{ workspace_id: string }>(
      "SELECT workspace_id FROM workspaces WHERE workspace_key = ? LIMIT 1",
      ["agent-a"],
    );
    expect(workspace).toBeTruthy();
    expect(job!.workspace_id).toBe(workspace!.workspace_id);
  });

  it("avoids turn key collisions between raw and encoded key parts", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("ok"),
      fetchImpl: fetch404,
    });

    await runtime.turn({
      channel: "test",
      thread_id: "a:b",
      message: "m1",
    });
    const first = await container.db.get<{ key: string }>(
      "SELECT key FROM execution_runs ORDER BY rowid DESC LIMIT 1",
    );
    expect(first).toBeTruthy();

    await runtime.turn({
      channel: "test",
      thread_id: "YTpi",
      message: "m2",
    });
    const second = await container.db.get<{ key: string }>(
      "SELECT key FROM execution_runs ORDER BY rowid DESC LIMIT 1",
    );
    expect(second).toBeTruthy();

    expect(first!.key).not.toBe(second!.key);
  });

  it("scopes the turn key by container_kind to avoid cross-thread collisions", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      languageModel: createStubLanguageModel("ok"),
      fetchImpl: fetch404,
    });

    await runtime.turn({
      channel: "test",
      thread_id: "same-id",
      message: "m1",
      container_kind: "dm",
    });

    const first = await container.db.get<{ key: string }>(
      "SELECT key FROM execution_runs ORDER BY rowid DESC LIMIT 1",
    );
    expect(first).toBeTruthy();
    expect(first!.key.includes(":dm:")).toBe(true);

    await runtime.turn({
      channel: "test",
      thread_id: "same-id",
      message: "m2",
      container_kind: "group",
    });

    const second = await container.db.get<{ key: string }>(
      "SELECT key FROM execution_runs ORDER BY rowid DESC LIMIT 1",
    );
    expect(second).toBeTruthy();
    expect(second!.key.includes(":group:")).toBe(true);

    expect(first!.key).not.toBe(second!.key);
  });

  it("trims channel and thread_id when building execution turn keys", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const runtime = new AgentRuntime({
      container,
      home: homeDir,
      workspaceId: "work",
      languageModel: createStubLanguageModel("ok"),
      fetchImpl: fetch404,
    });

    await runtime.turn({
      channel: " test ",
      thread_id: " thread-1 ",
      message: "m1",
    });

    const run = await container.db.get<{ key: string }>(
      "SELECT key FROM execution_runs ORDER BY rowid DESC LIMIT 1",
    );
    expect(run).toBeTruthy();
    expect(run!.key).toBe("agent:default:test:work:channel:thread-1");
  });

});
