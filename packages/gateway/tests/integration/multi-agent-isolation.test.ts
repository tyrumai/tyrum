import { describe, it, expect, afterEach } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("multi-agent isolation", () => {
  let db: SqliteDb | undefined;
  const originalEnv = process.env["TYRUM_MULTI_AGENT"];

  afterEach(async () => {
    if (db) { await db.close(); db = undefined; }
    if (originalEnv === undefined) {
      delete process.env["TYRUM_MULTI_AGENT"];
    } else {
      process.env["TYRUM_MULTI_AGENT"] = originalEnv;
    }
  });

  it("agent_id column exists with default value on facts", async () => {
    db = openTestSqliteDb();
    await db.run(
      "INSERT INTO facts (fact_key, fact_value, source, observed_at, confidence) VALUES (?, ?, ?, ?, ?)",
      ["test-key", "test-value", "test", "2025-01-01T00:00:00Z", 0.9],
    );
    const row = await db.get<{ agent_id: string }>(
      "SELECT agent_id FROM facts WHERE fact_key = ?",
      ["test-key"],
    );
    expect(row?.agent_id).toBe("default");
  });

  it("agent_id column exists with default value on approvals", async () => {
    db = openTestSqliteDb();
    await db.run(
      "INSERT INTO approvals (plan_id, step_index, prompt, context_json) VALUES (?, ?, ?, ?)",
      ["plan-1", 0, "test", "{}"],
    );
    const row = await db.get<{ agent_id: string }>(
      "SELECT agent_id FROM approvals WHERE plan_id = ?",
      ["plan-1"],
    );
    expect(row?.agent_id).toBe("default");
  });

  it("agent_id column exists with default value on execution_jobs", async () => {
    db = openTestSqliteDb();
    const jobId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    await db.run(
      "INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id) VALUES (?, ?, ?, 'queued', '{}', '{}', ?)",
      [jobId, "test", "main", runId],
    );
    const row = await db.get<{ agent_id: string }>(
      "SELECT agent_id FROM execution_jobs WHERE job_id = ?",
      [jobId],
    );
    expect(row?.agent_id).toBe("default");
  });

  it("agent_id column exists with default value on execution_runs", async () => {
    db = openTestSqliteDb();
    const jobId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    await db.run(
      "INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id) VALUES (?, ?, ?, 'queued', '{}', '{}', ?)",
      [jobId, "test", "main", runId],
    );
    await db.run(
      "INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt) VALUES (?, ?, ?, ?, 'queued', 1)",
      [runId, jobId, "test", "main"],
    );
    const row = await db.get<{ agent_id: string }>(
      "SELECT agent_id FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(row?.agent_id).toBe("default");
  });

  it("agent_id column exists with default value on artifact_metadata", async () => {
    db = openTestSqliteDb();
    const artifactId = crypto.randomUUID();
    await db.run(
      "INSERT INTO artifact_metadata (artifact_id, kind, uri) VALUES (?, ?, ?)",
      [artifactId, "screenshot", `artifact://${artifactId}`],
    );
    const row = await db.get<{ agent_id: string }>(
      "SELECT agent_id FROM artifact_metadata WHERE artifact_id = ?",
      [artifactId],
    );
    expect(row?.agent_id).toBe("default");
  });

  it("different agents can have separate facts", async () => {
    db = openTestSqliteDb();
    await db.run(
      "INSERT INTO facts (fact_key, fact_value, source, observed_at, confidence, agent_id) VALUES (?, ?, ?, ?, ?, ?)",
      ["shared-key", "value-a", "test", "2025-01-01T00:00:00Z", 0.9, "agent-a"],
    );
    await db.run(
      "INSERT INTO facts (fact_key, fact_value, source, observed_at, confidence, agent_id) VALUES (?, ?, ?, ?, ?, ?)",
      ["shared-key", "value-b", "test", "2025-01-01T00:00:00Z", 0.9, "agent-b"],
    );
    const agentAFacts = await db.all<{ fact_value: string }>(
      "SELECT fact_value FROM facts WHERE fact_key = ? AND agent_id = ?",
      ["shared-key", "agent-a"],
    );
    expect(agentAFacts).toHaveLength(1);
    expect(agentAFacts[0]?.fact_value).toBe("value-a");

    const agentBFacts = await db.all<{ fact_value: string }>(
      "SELECT fact_value FROM facts WHERE fact_key = ? AND agent_id = ?",
      ["shared-key", "agent-b"],
    );
    expect(agentBFacts).toHaveLength(1);
    expect(agentBFacts[0]?.fact_value).toBe("value-b");
  });
});
