import { afterEach, describe, expect, it } from "vitest";
import type { Playbook } from "@tyrum/schemas";
import { DurablePlaybookRunner } from "../../src/modules/playbook/durable-runner.js";
import { PlaybookRunner } from "../../src/modules/playbook/runner.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

const testPlaybook: Playbook = {
  manifest: {
    id: "test-playbook",
    name: "Test Playbook",
    version: "1.0.0",
    steps: [
      { id: "step-1", command: "research query about testing" },
      { id: "step-2", command: "http GET https://example.com" },
    ],
  },
  file_path: "/test/playbook.yaml",
  loaded_at: new Date().toISOString(),
};

describe("DurablePlaybookRunner", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("creates execution_jobs, execution_runs, and execution_steps", async () => {
    db = openTestSqliteDb();
    const durableRunner = new DurablePlaybookRunner(db);

    const result = await durableRunner.runDurable(testPlaybook);

    const jobs = await db.all<{ job_id: string; status: string; key: string; lane: string }>(
      "SELECT job_id, status, key, lane FROM execution_jobs WHERE job_id = ?",
      [result.job_id],
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe("running");
    expect(jobs[0]!.key).toBe("playbook:test-playbook");
    expect(jobs[0]!.lane).toBe("playbook");

    const runs = await db.all<{ run_id: string; status: string }>(
      "SELECT run_id, status FROM execution_runs WHERE run_id = ?",
      [result.run_id],
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("queued");

    const steps = await db.all<{ step_id: string; step_index: number; status: string }>(
      "SELECT step_id, step_index, status FROM execution_steps WHERE run_id = ? ORDER BY step_index",
      [result.run_id],
    );
    expect(steps).toHaveLength(2);
    expect(steps[0]!.step_index).toBe(0);
    expect(steps[1]!.step_index).toBe(1);
    expect(steps[0]!.status).toBe("queued");
    expect(steps[1]!.status).toBe("queued");
  });

  it("step count matches playbook steps", async () => {
    db = openTestSqliteDb();
    const durableRunner = new DurablePlaybookRunner(db);

    const result = await durableRunner.runDurable(testPlaybook);

    expect(result.step_count).toBe(testPlaybook.manifest.steps.length);
    expect(result.step_count).toBe(2);
  });

  it("trigger_json contains playbook_id", async () => {
    db = openTestSqliteDb();
    const durableRunner = new DurablePlaybookRunner(db);

    const result = await durableRunner.runDurable(testPlaybook);

    const job = await db.get<{ trigger_json: string }>(
      "SELECT trigger_json FROM execution_jobs WHERE job_id = ?",
      [result.job_id],
    );
    const trigger = JSON.parse(job!.trigger_json) as {
      kind: string;
      metadata: { playbook_id: string };
    };
    expect(trigger.kind).toBe("playbook");
    expect(trigger.metadata.playbook_id).toBe("test-playbook");
  });

  it("returns correct playbook_id in result", async () => {
    db = openTestSqliteDb();
    const durableRunner = new DurablePlaybookRunner(db);

    const result = await durableRunner.runDurable(testPlaybook);

    expect(result.playbook_id).toBe("test-playbook");
    expect(result.job_id).toBeTruthy();
    expect(result.run_id).toBeTruthy();
    expect(result.created_at).toBeTruthy();
  });

  it("persists action_json for each step with correct types", async () => {
    db = openTestSqliteDb();
    const durableRunner = new DurablePlaybookRunner(db);

    const result = await durableRunner.runDurable(testPlaybook);

    const steps = await db.all<{ action_json: string; step_index: number }>(
      "SELECT action_json, step_index FROM execution_steps WHERE run_id = ? ORDER BY step_index",
      [result.run_id],
    );

    const action0 = JSON.parse(steps[0]!.action_json) as { type: string };
    expect(action0.type).toBe("Research");

    const action1 = JSON.parse(steps[1]!.action_json) as { type: string };
    expect(action1.type).toBe("Http");
  });

  it("stores idempotency_key on steps", async () => {
    db = openTestSqliteDb();
    const durableRunner = new DurablePlaybookRunner(db);

    const result = await durableRunner.runDurable(testPlaybook);

    const steps = await db.all<{ idempotency_key: string | null; step_index: number }>(
      "SELECT idempotency_key, step_index FROM execution_steps WHERE run_id = ? ORDER BY step_index",
      [result.run_id],
    );

    expect(steps[0]!.idempotency_key).toBe("playbook:test-playbook:step-1");
    expect(steps[1]!.idempotency_key).toBe("playbook:test-playbook:step-2");
  });

  it("accepts a custom requestId", async () => {
    db = openTestSqliteDb();
    const durableRunner = new DurablePlaybookRunner(db);

    const result = await durableRunner.runDurable(testPlaybook, "custom-request-id");

    const job = await db.get<{ input_json: string }>(
      "SELECT input_json FROM execution_jobs WHERE job_id = ?",
      [result.job_id],
    );
    const input = JSON.parse(job!.input_json) as { request_id: string };
    expect(input.request_id).toBe("custom-request-id");
  });

  it("accepts an injected PlaybookRunner", async () => {
    db = openTestSqliteDb();
    const runner = new PlaybookRunner();
    const durableRunner = new DurablePlaybookRunner(db, runner);

    const result = await durableRunner.runDurable(testPlaybook);
    expect(result.step_count).toBe(2);

    // The injected runner should track stats
    const stats = runner.getStats();
    expect(stats).toHaveLength(1);
    expect(stats[0]!.playbook_id).toBe("test-playbook");
    expect(stats[0]!.run_count).toBe(1);
  });

  it("runLegacy delegates to the inner runner without touching the database", async () => {
    db = openTestSqliteDb();
    const durableRunner = new DurablePlaybookRunner(db);

    const result = durableRunner.runLegacy(testPlaybook);

    expect(result.playbook_id).toBe("test-playbook");
    expect(result.steps).toHaveLength(2);

    // No execution records should exist
    const jobs = await db.all("SELECT * FROM execution_jobs");
    expect(jobs).toHaveLength(0);
  });
});
