#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

if [[ -z "${GATEWAY_TOKEN:-}" ]]; then
  export GATEWAY_TOKEN
  GATEWAY_TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
  echo "[smoke] generated ephemeral GATEWAY_TOKEN for this run"
fi

cleanup() {
  if [[ "${TYRUM_SMOKE_KEEP_RUNNING:-}" == "1" ]]; then
    echo "[smoke] leaving containers running (TYRUM_SMOKE_KEEP_RUNNING=1)"
    return
  fi
  docker compose --profile split down >/dev/null 2>&1 || true
}

trap cleanup EXIT

echo "[smoke] starting split profile (edge/worker/scheduler + postgres)"
docker compose --profile split up -d --build postgres tyrum-edge tyrum-worker tyrum-scheduler

echo "[smoke] waiting for edge /healthz"
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:8788/healthz" >/dev/null; then
    echo "[smoke] healthz ok"
    break
  fi
  sleep 1
done

echo "[smoke] enqueueing one execution run via workflow API (and polling Postgres)"
 docker compose --profile split exec -T -w /app/packages/gateway tyrum-worker node --input-type=module -e '
 import { Client } from "pg";
 import { randomUUID } from "node:crypto";

const dbUri = process.env.GATEWAY_DB_PATH;
if (!dbUri) throw new Error("GATEWAY_DB_PATH is not set in tyrum-worker");
const token = process.env.GATEWAY_TOKEN;
if (!token) throw new Error("GATEWAY_TOKEN is not set in tyrum-worker");

const client = new Client({ connectionString: dbUri });
await client.connect();

const workflowRes = await fetch("http://tyrum-edge:8788/workflow/run", {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    key: "agent:default:smoke:main",
    lane: "main",
    plan_id: "smoke-postgres-split",
    request_id: `req-smoke-${randomUUID()}`,
    steps: [
      {
        type: "CLI",
        args: { cmd: "echo", args: ["hello-from-postgres-split-smoke"], cwd: "." },
        idempotency_key: `smoke-${randomUUID()}`,
      },
    ],
  }),
});

if (!workflowRes.ok) {
  const text = await workflowRes.text().catch(() => "<no body>");
  throw new Error(`[smoke] workflow.run failed: status=${workflowRes.status} body=${text}`);
}

const data = await workflowRes.json();
const runId = data.run_id;
if (typeof runId !== "string" || runId.length === 0) {
  throw new Error(`[smoke] workflow.run response missing run_id: ${JSON.stringify(data)}`);
}

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
