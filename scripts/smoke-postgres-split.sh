#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "[smoke] starting split profile (edge/worker/scheduler + postgres)"
docker compose --profile split up -d --build

echo "[smoke] waiting for edge /healthz"
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:8788/healthz" >/dev/null; then
    echo "[smoke] healthz ok"
    break
  fi
  sleep 1
done

echo "[smoke] enqueueing one execution job into Postgres (via worker container)"
docker compose --profile split exec -T tyrum-worker node --input-type=module -e '
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const dbUri = process.env.GATEWAY_DB_PATH;
if (!dbUri) throw new Error("GATEWAY_DB_PATH is not set in tyrum-worker");

const client = new Client({ connectionString: dbUri });
await client.connect();

const jobId = `job-smoke-${randomUUID()}`;
const runId = `run-smoke-${randomUUID()}`;
const stepId = `step-smoke-${randomUUID()}`;

const triggerJson = JSON.stringify({ metadata: { plan_id: "smoke-postgres-split" } });
const actionJson = JSON.stringify({
  type: "CLI",
  args: { cmd: "echo", args: ["hello-from-postgres-split-smoke"], cwd: "." },
});

await client.query(
  `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id)
   VALUES ($1, $2, $3, ''queued'', $4, NULL, $5)`,
  [jobId, "smoke", "default", triggerJson, runId],
);
await client.query(
  `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
   VALUES ($1, $2, $3, $4, ''queued'', 1)`,
  [runId, jobId, "smoke", "default"],
);
await client.query(
  `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json, max_attempts, timeout_ms)
   VALUES ($1, $2, 0, ''queued'', $3, 1, 30000)`,
  [stepId, runId, actionJson],
);

const deadlineMs = Date.now() + 120_000;
for (;;) {
  const { rows } = await client.query(
    "SELECT status FROM execution_runs WHERE run_id = $1",
    [runId],
  );
  const status = rows[0]?.status;
  if (status === "succeeded") {
    console.log(`[smoke] run ${runId} succeeded`);
    break;
  }
  if (status === "failed" || status === "cancelled") {
    throw new Error(`[smoke] run ${runId} ended with status=${status}`);
  }
  if (Date.now() > deadlineMs) {
    throw new Error(`[smoke] timed out waiting for run ${runId} to complete`);
  }
  await new Promise((r) => setTimeout(r, 1000));
}

await client.end();
'

echo "[smoke] ok"
