import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

describe("usage routes", () => {
  it("rolls up attempt costs across execution attempts", async () => {
    const { app, container } = await createTestApp();

    const jobId = "job-usage-1";
    const runId = "run-usage-1";
    const stepId = "step-usage-1";
    const attemptId = "attempt-usage-1";

    await container.db.run(
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id)
       VALUES (?, ?, ?, 'completed', ?, ?, ?)`,
      [jobId, "key-1", "lane-1", "{}", "{}", runId],
    );
    await container.db.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
       VALUES (?, ?, ?, ?, 'succeeded', 1)`,
      [runId, jobId, "key-1", "lane-1"],
    );
    await container.db.run(
      `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
       VALUES (?, ?, 0, 'succeeded', ?)`,
      [stepId, runId, "{}"],
    );

    const costJson = JSON.stringify({
      duration_ms: 1234,
      total_tokens: 50,
      usd_micros: 987,
    });

    await container.db.run(
      `INSERT INTO execution_attempts (
         attempt_id,
         step_id,
         attempt,
         status,
         started_at,
         finished_at,
         artifacts_json,
         cost_json
       ) VALUES (?, ?, 1, 'succeeded', ?, ?, '[]', ?)`,
      [attemptId, stepId, new Date().toISOString(), new Date().toISOString(), costJson],
    );

    const res = await app.request("/usage");
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      local: { attempts: { total_with_cost: number; parsed: number; invalid: number }; totals: { duration_ms: number; total_tokens: number; usd_micros: number } };
    };

    expect(payload.local.attempts).toEqual({
      total_with_cost: 1,
      parsed: 1,
      invalid: 0,
    });
    expect(payload.local.totals.total_tokens).toBe(50);
    expect(payload.local.totals.duration_ms).toBe(1234);
    expect(payload.local.totals.usd_micros).toBe(987);

    const filtered = await app.request(`/usage?run_id=${encodeURIComponent(runId)}`);
    expect(filtered.status).toBe(200);
    const filteredPayload = (await filtered.json()) as typeof payload;
    expect(filteredPayload.local.attempts.total_with_cost).toBe(1);
    expect(filteredPayload.local.totals.total_tokens).toBe(50);

    const empty = await app.request(`/usage?run_id=missing`);
    expect(empty.status).toBe(200);
    const emptyPayload = (await empty.json()) as typeof payload;
    expect(emptyPayload.local.attempts.total_with_cost).toBe(0);
    expect(emptyPayload.local.totals.total_tokens).toBe(0);

    await container.db.close();
  });
});

