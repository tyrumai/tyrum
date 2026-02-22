import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createTestContainer } from "./helpers.js";

describe("workflow routes", () => {
  const originalFlag = process.env["TYRUM_ENGINE_API_ENABLED"];

  beforeEach(() => {
    process.env["TYRUM_ENGINE_API_ENABLED"] = "1";
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env["TYRUM_ENGINE_API_ENABLED"];
    } else {
      process.env["TYRUM_ENGINE_API_ENABLED"] = originalFlag;
    }
  });

  it("POST /workflow/run enqueues a durable execution run", async () => {
    const container = await createTestContainer();
    const app = createApp(container);

    const res = await app.request("/workflow/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: "key-1",
        lane: "lane-1",
        steps: [{ type: "CLI" }],
      }),
    });

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { status: string; job_id: string; run_id: string };
    expect(payload.status).toBe("ok");
    expect(payload.job_id).toBeTruthy();
    expect(payload.run_id).toBeTruthy();

    const job = await container.db.get<{ job_id: string }>(
      "SELECT job_id FROM execution_jobs WHERE job_id = ?",
      [payload.job_id],
    );
    expect(job?.job_id).toBe(payload.job_id);

    const run = await container.db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [payload.run_id],
    );
    expect(run?.status).toBe("queued");

    const stepAgg = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM execution_steps WHERE run_id = ?",
      [payload.run_id],
    );
    expect(stepAgg?.n).toBe(1);

    const outboxRows = await container.db.all<{ topic: string; payload_json: string }>(
      "SELECT topic, payload_json FROM outbox ORDER BY id ASC",
    );
    const messages = outboxRows
      .filter((r) => r.topic === "ws.broadcast")
      .map((r) => {
        try {
          return JSON.parse(r.payload_json) as unknown;
        } catch {
          return null;
        }
      })
      .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object");
    const types = messages
      .map((m) => (m["message"] as Record<string, unknown> | undefined)?.["type"])
      .filter((t): t is string => typeof t === "string");
    expect(types).toContain("run.updated");
    expect(types).toContain("step.updated");

    await container.db.close();
  });

  it("POST /workflow/resume resumes a paused run via resume token", async () => {
    const container = await createTestContainer();
    const app = createApp(container);

    const jobId = "job-resume-1";
    const runId = "run-resume-1";
    const stepId = "step-resume-1";
    const token = "resume-test-1";

    await container.db.run(
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id)
       VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
      [jobId, "key-1", "lane-1", "{}", "{}", runId],
    );
    await container.db.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt, paused_reason, paused_detail)
       VALUES (?, ?, ?, ?, 'paused', 1, 'test', 'paused')`,
      [runId, jobId, "key-1", "lane-1"],
    );
    await container.db.run(
      `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
       VALUES (?, ?, 0, 'paused', ?)`,
      [stepId, runId, "{}"],
    );
    await container.db.run(
      `INSERT INTO resume_tokens (token, run_id)
       VALUES (?, ?)`,
      [token, runId],
    );

    const res = await app.request("/workflow/resume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { status: string; run_id: string };
    expect(payload.status).toBe("ok");
    expect(payload.run_id).toBe(runId);

    const run = await container.db.get<{ status: string }>(
      "SELECT status FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run?.status).toBe("queued");

    const step = await container.db.get<{ status: string }>(
      "SELECT status FROM execution_steps WHERE step_id = ?",
      [stepId],
    );
    expect(step?.status).toBe("queued");

    await container.db.close();
  });
});
