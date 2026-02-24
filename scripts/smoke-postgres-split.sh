#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

temp_dir=""

if [[ -z "${COMPOSE_PROJECT_NAME:-}" ]]; then
  export COMPOSE_PROJECT_NAME="tyrum-smoke-split-${RANDOM}"
fi

# Snapshot import is intentionally disabled by default. Smoke tests enable it explicitly.
export TYRUM_SNAPSHOT_IMPORT_ENABLED="${TYRUM_SNAPSHOT_IMPORT_ENABLED:-1}"

if [[ -z "${GATEWAY_TOKEN:-}" ]]; then
  export GATEWAY_TOKEN
  if command -v openssl >/dev/null 2>&1; then
    GATEWAY_TOKEN="$(openssl rand -hex 32)"
  else
    GATEWAY_TOKEN="$(node -e 'console.log(require(\"node:crypto\").randomBytes(32).toString(\"hex\"))')"
  fi
  echo "[smoke] generated ephemeral GATEWAY_TOKEN for this run"
fi

cleanup() {
  if [[ "${TYRUM_SMOKE_KEEP_RUNNING:-}" == "1" ]]; then
    echo "[smoke] leaving containers running (TYRUM_SMOKE_KEEP_RUNNING=1)"
    return
  fi
  docker compose --profile split down -v >/dev/null 2>&1 || true
  if [[ -n "$temp_dir" ]]; then
    rm -rf "$temp_dir" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

wait_for_healthz() {
  echo "[smoke] waiting for edge /healthz"
  for _ in $(seq 1 60); do
    if curl -fsS "http://localhost:8788/healthz" >/dev/null 2>&1; then
      echo "[smoke] healthz ok"
      return 0
    fi
    sleep 1
  done
  echo "[smoke] healthz did not become ready"
  docker compose --profile split logs tyrum-edge || true
  return 1
}

export_snapshot() {
  local out="$1"
  local code
  code="$(curl -sS -o "$out" -w "%{http_code}" -H "authorization: Bearer ${GATEWAY_TOKEN}" "http://localhost:8788/snapshot/export")"
  if [[ "$code" != "200" ]]; then
    echo "[smoke] snapshot export failed: status=$code"
    cat "$out" || true
    return 1
  fi
}

build_import_request() {
  local bundle_path="$1"
  local out="$2"
  python3 - "$bundle_path" "$out" <<'PY'
import json
import sys

bundle_path = sys.argv[1]
out_path = sys.argv[2]

with open(bundle_path, "r", encoding="utf-8") as f:
    bundle = json.load(f)

req = {"confirm": "IMPORT", "bundle": bundle}

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(req, f)
PY
}

import_snapshot() {
  local req="$1"
  local out="$2"
  local code
  code="$(curl -sS -o "$out" -w "%{http_code}" -H "authorization: Bearer ${GATEWAY_TOKEN}" -H "content-type: application/json" --data-binary "@${req}" "http://localhost:8788/snapshot/import")"
  if [[ "$code" != "200" ]]; then
    echo "[smoke] snapshot import failed: status=$code"
    cat "$out" || true
    return 1
  fi
}

echo "[smoke] starting split profile (edge/worker/scheduler + postgres)"
docker compose --profile split up -d --build postgres tyrum-edge tyrum-worker tyrum-scheduler

wait_for_healthz

echo "[smoke] enqueueing one execution run via workflow API (and polling Postgres)"
run_line="$(
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
    "SELECT status, paused_reason FROM execution_runs WHERE run_id = $1",
    [runId],
  );
  const status = rows[0]?.status;
  const pausedReason = rows[0]?.paused_reason;
  if (status === "succeeded") {
    console.log(`[smoke] run ${runId} succeeded`);
    break;
  }
  if (status === "failed" || status === "cancelled") {
    throw new Error(`[smoke] run ${runId} ended with status=${status}`);
  }
  if (status === "paused") {
    if (pausedReason !== "policy") {
      throw new Error(`[smoke] run ${runId} paused unexpectedly: reason=${pausedReason ?? "<none>"}`);
    }

    const approvalRes = await client.query(
      "SELECT id FROM approvals WHERE run_id = $1 AND status = $2 AND kind = $3 ORDER BY id ASC LIMIT 1",
      [runId, "pending", "policy"],
    );
    const approvalIdRaw = approvalRes.rows[0]?.id;
    const approvalId = approvalIdRaw !== undefined && approvalIdRaw !== null ? String(approvalIdRaw) : "";
    if (!approvalId) {
      throw new Error(`[smoke] run ${runId} paused for policy but no pending approval found`);
    }

    const approveRes = await fetch(
      `http://tyrum-edge:8788/approvals/${approvalId}/respond`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ decision: "approved" }),
      },
    );
    if (!approveRes.ok) {
      const text = await approveRes.text().catch(() => "<no body>");
      throw new Error(`[smoke] approval.respond failed: status=${approveRes.status} body=${text}`);
    }

    console.log(`[smoke] approved policy gate: run_id=${runId} approval_id=${approvalId}`);
  }
  if (Date.now() > deadlineMs) {
    throw new Error(
      `[smoke] timed out waiting for run ${runId} to complete (status=${status ?? "<missing>"} paused_reason=${pausedReason ?? "<none>"})`,
    );
  }
  await new Promise((r) => setTimeout(r, 1000));
}

await client.end();

console.log(`SMOKE_RUN_ID=${runId}`);
'
)"

source_run_line="$(echo "$run_line" | tail -n 1)"
source_run_id="${source_run_line#SMOKE_RUN_ID=}"
if [[ -z "${source_run_id}" || "${source_run_id}" == "${source_run_line}" ]]; then
  echo "[smoke] unable to parse SMOKE_RUN_ID from: ${source_run_line}"
  echo "$run_line"
  exit 1
fi

temp_dir="$(mktemp -d)"
snapshot_bundle="${temp_dir}/snapshot-bundle.json"
import_req="${temp_dir}/snapshot-import.json"
import_res="${temp_dir}/snapshot-import-response.json"

echo "[smoke] exporting snapshot bundle"
export_snapshot "$snapshot_bundle"

echo "[smoke] restarting with empty state (restore target)"
docker compose --profile split down -v >/dev/null 2>&1 || true
docker compose --profile split up -d --build postgres tyrum-edge tyrum-worker tyrum-scheduler
wait_for_healthz

build_import_request "$snapshot_bundle" "$import_req"

echo "[smoke] importing snapshot bundle (requires TYRUM_SNAPSHOT_IMPORT_ENABLED=1)"
import_snapshot "$import_req" "$import_res"

echo "[smoke] verifying restored state is present"
docker compose --profile split exec -T -e "SMOKE_RUN_ID=${source_run_id}" -w /app/packages/gateway tyrum-worker node --input-type=module -e '
 import { Client } from "pg";

const runId = process.env.SMOKE_RUN_ID;
if (!runId) throw new Error("SMOKE_RUN_ID missing");

const dbUri = process.env.GATEWAY_DB_PATH;
if (!dbUri) throw new Error("GATEWAY_DB_PATH is not set in tyrum-worker");

const client = new Client({ connectionString: dbUri });
await client.connect();

const { rows } = await client.query(
  "SELECT status FROM execution_runs WHERE run_id = $1",
  [runId],
);
const status = rows[0]?.status;
if (status !== "succeeded") {
  throw new Error(`[smoke] restored run not found or not succeeded: run_id=${runId} status=${status ?? "<missing>"}`);
}
console.log(`[smoke] restored run present: ${runId}`);

await client.end();
'

echo "[smoke] ok"
