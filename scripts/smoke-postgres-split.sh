#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

temp_dir=""

if [[ -z "${COMPOSE_PROJECT_NAME:-}" ]]; then
  export COMPOSE_PROJECT_NAME="tyrum-smoke-split-${RANDOM}"
fi

# Snapshot import is disabled by default; smoke restores opt in explicitly.
export TYRUM_SNAPSHOT_IMPORT_ENABLED="${TYRUM_SNAPSHOT_IMPORT_ENABLED:-1}"

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

read_bootstrap_token() {
  local label="$1"
  local token=""
  local pattern=""

  pattern="tyrum-token\\.v1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+"

  for _ in $(seq 1 80); do
    token="$(
      docker compose --profile split logs --no-color 2>/dev/null \
        | grep -Eo "${label}: ${pattern}" \
        | tail -n 1 \
        | sed -E "s/^${label}: //"
    )"
    if [[ -n "$token" ]]; then
      echo "$token"
      return 0
    fi
    sleep 0.5
  done

  echo "[smoke] unable to read bootstrap token '${label}' from split profile logs" >&2
  docker compose --profile split logs || true
  return 1
}

export_snapshot() {
  local token="$1"
  local out="$2"
  local code
  code="$(curl -sS -o "$out" -w "%{http_code}" -H "authorization: Bearer ${token}" "http://localhost:8788/snapshot/export")"
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
  local token="$1"
  local req="$2"
  local out="$3"
  local code
  code="$(curl -sS -o "$out" -w "%{http_code}" -H "authorization: Bearer ${token}" -H "content-type: application/json" --data-binary "@${req}" "http://localhost:8788/snapshot/import")"
  if [[ "$code" != "200" ]]; then
    echo "[smoke] snapshot import failed: status=$code"
    cat "$out" || true
    return 1
  fi
}

echo "[smoke] starting split profile (edge/worker/scheduler + postgres)"
docker compose --profile split up -d --build postgres tyrum-edge tyrum-worker tyrum-scheduler

wait_for_healthz

source_token="$(read_bootstrap_token "default-tenant-admin")"

echo "[smoke] enqueueing one execution run via workflow API (and polling Postgres)"
run_line="$(
  docker compose --profile split exec -T -e "SMOKE_ADMIN_TOKEN=${source_token}" -w /app/packages/gateway tyrum-worker node --input-type=module -e '
 import { Client } from "pg";
 import { randomUUID } from "node:crypto";

const dbUri = process.env.GATEWAY_DB_PATH;
if (!dbUri) throw new Error("GATEWAY_DB_PATH is not set in tyrum-worker");
const token = process.env.SMOKE_ADMIN_TOKEN;
if (!token) throw new Error("SMOKE_ADMIN_TOKEN is missing");

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
      "SELECT approval_id, status FROM approvals WHERE run_id = $1 AND kind = $2 ORDER BY created_at ASC, approval_id ASC LIMIT 1",
      [runId, "policy"],
    );
    const approvalId = approvalRes.rows[0]?.approval_id;
    const approvalStatus = approvalRes.rows[0]?.status;
    if (approvalStatus === "reviewing") {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    if (approvalStatus === "denied" || approvalStatus === "expired" || approvalStatus === "cancelled") {
      throw new Error(
        `[smoke] run ${runId} paused for policy but approval ${approvalId ?? "<missing>"} is terminal with status=${approvalStatus}`,
      );
    }
    if (
      (approvalStatus !== "queued" && approvalStatus !== "awaiting_human") ||
      typeof approvalId !== "string" ||
      approvalId.length === 0
    ) {
      throw new Error(
        `[smoke] run ${runId} paused for policy but no human-resolvable approval found (status=${approvalStatus ?? "<missing>"})`,
      );
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
export_snapshot "$source_token" "$snapshot_bundle"

echo "[smoke] restarting with empty state (restore target)"
docker compose --profile split down -v >/dev/null 2>&1 || true
docker compose --profile split up -d --build postgres tyrum-edge tyrum-worker tyrum-scheduler
wait_for_healthz

target_token="$(read_bootstrap_token "default-tenant-admin")"

build_import_request "$snapshot_bundle" "$import_req"

echo "[smoke] importing snapshot bundle"
import_snapshot "$target_token" "$import_req" "$import_res"

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
