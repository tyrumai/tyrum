#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

temp_dir=""

if [[ -z "${COMPOSE_PROJECT_NAME:-}" ]]; then
  export COMPOSE_PROJECT_NAME="tyrum-smoke-sqlite-${RANDOM}"
fi

if [[ -z "${GATEWAY_TOKEN:-}" ]]; then
  export GATEWAY_TOKEN
  if command -v openssl >/dev/null 2>&1; then
    GATEWAY_TOKEN="$(openssl rand -hex 32)"
  else
    GATEWAY_TOKEN="$(node -e 'console.log(require(\"node:crypto\").randomBytes(32).toString(\"hex\"))')"
  fi
  echo "[smoke] generated ephemeral GATEWAY_TOKEN for this run"
fi

# Snapshot import is intentionally disabled by default. Smoke tests enable it explicitly.
export TYRUM_SNAPSHOT_IMPORT_ENABLED="${TYRUM_SNAPSHOT_IMPORT_ENABLED:-1}"

cleanup() {
  if [[ "${TYRUM_SMOKE_KEEP_RUNNING:-}" == "1" ]]; then
    echo "[smoke] leaving containers running (TYRUM_SMOKE_KEEP_RUNNING=1)"
    return
  fi
  docker compose down -v >/dev/null 2>&1 || true
  if [[ -n "$temp_dir" ]]; then
    rm -rf "$temp_dir" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

wait_for_healthz() {
  echo "[smoke] waiting for /healthz"
  for _ in $(seq 1 60); do
    if curl -fsS "http://localhost:8788/healthz" >/dev/null 2>&1; then
      echo "[smoke] healthz ok"
      return 0
    fi
    sleep 1
  done
  echo "[smoke] healthz did not become ready"
  docker compose logs tyrum || true
  return 1
}

read_admin_token() {
  local token=""
  for _ in $(seq 1 40); do
    token="$(
      docker compose exec -T tyrum sh -lc 'cat /var/lib/tyrum/.admin-token 2>/dev/null || true' \
        | tr -d '\r\n'
    )"
    if [[ -n "$token" ]]; then
      echo "$token"
      return 0
    fi
    sleep 0.5
  done
  echo "[smoke] unable to read /var/lib/tyrum/.admin-token" >&2
  return 1
}

enqueue_and_wait_sqlite_run() {
  docker compose exec -T -w /app/packages/gateway tyrum node --input-type=module -e '
    import Database from "better-sqlite3";
    import { readFileSync } from "node:fs";
    import { randomUUID } from "node:crypto";

    const dbPath = process.env.GATEWAY_DB_PATH;
    if (!dbPath) throw new Error("GATEWAY_DB_PATH is not set in tyrum service");
    const token = readFileSync("/var/lib/tyrum/.admin-token", "utf-8").trim();
    if (!token) throw new Error("admin token is empty");

    const workflowRes = await fetch("http://127.0.0.1:8788/workflow/run", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        key: "agent:default:smoke:main",
        lane: "main",
        plan_id: "smoke-sqlite-single-host",
        request_id: `req-smoke-${randomUUID()}`,
        steps: [
          {
            type: "CLI",
            args: { cmd: "echo", args: ["hello-from-sqlite-single-host-smoke"], cwd: "." },
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

    const db = new Database(dbPath);
    try {
      const deadlineMs = Date.now() + 120_000;
      for (;;) {
        const row = db.prepare("SELECT status FROM execution_runs WHERE run_id = ?").get(runId);
        const status = row?.status;
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
    } finally {
      db.close();
    }

    console.log(`SMOKE_RUN_ID=${runId}`);
  '
}

verify_sqlite_run_present() {
  local run_id="$1"
  docker compose exec -T -e "SMOKE_RUN_ID=${run_id}" -w /app/packages/gateway tyrum node --input-type=module -e '
    import Database from "better-sqlite3";
    const runId = process.env.SMOKE_RUN_ID;
    if (!runId) throw new Error("SMOKE_RUN_ID missing");
    const dbPath = process.env.GATEWAY_DB_PATH;
    if (!dbPath) throw new Error("GATEWAY_DB_PATH is not set in tyrum service");
    const db = new Database(dbPath);
    try {
      const row = db.prepare("SELECT status FROM execution_runs WHERE run_id = ?").get(runId);
      if (!row) throw new Error(`[smoke] restored run not found: ${runId}`);
      if (row.status !== "succeeded") throw new Error(`[smoke] restored run has unexpected status=${row.status}`);
      console.log(`[smoke] restored run present: ${runId}`);
    } finally {
      db.close();
    }
  '
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

temp_dir="$(mktemp -d)"
snapshot_bundle="${temp_dir}/snapshot-bundle.json"
import_req="${temp_dir}/snapshot-import.json"
import_res="${temp_dir}/snapshot-import-response.json"

echo "[smoke] starting single-host (SQLite) reference deployment"
docker compose up -d --build tyrum
wait_for_healthz

source_token="$(read_admin_token)"
echo "[smoke] enqueueing one execution run via workflow API (and polling SQLite)"
run_line="$(enqueue_and_wait_sqlite_run | tail -n 1)"
source_run_id="${run_line#SMOKE_RUN_ID=}"
if [[ -z "${source_run_id}" || "${source_run_id}" == "${run_line}" ]]; then
  echo "[smoke] unable to parse SMOKE_RUN_ID from: ${run_line}"
  exit 1
fi

echo "[smoke] exporting snapshot bundle"
export_snapshot "$source_token" "$snapshot_bundle"

echo "[smoke] restarting with empty state (restore target)"
docker compose down -v >/dev/null 2>&1 || true
docker compose up -d --build tyrum
wait_for_healthz

target_token="$(read_admin_token)"
build_import_request "$snapshot_bundle" "$import_req"

echo "[smoke] importing snapshot bundle (requires TYRUM_SNAPSHOT_IMPORT_ENABLED=1)"
import_snapshot "$target_token" "$import_req" "$import_res"

echo "[smoke] verifying restored state is present"
verify_sqlite_run_present "$source_run_id"

echo "[smoke] ok"
