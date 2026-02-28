#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${COMPOSE_PROJECT_NAME:-}" ]]; then
  export COMPOSE_PROJECT_NAME="tyrum-smoke-desktop-sandbox-${RANDOM}"
fi

cleanup() {
  if [[ "${TYRUM_SMOKE_KEEP_RUNNING:-}" == "1" ]]; then
    echo "[smoke] leaving containers running (TYRUM_SMOKE_KEEP_RUNNING=1)"
    return
  fi
  docker compose --profile desktop-sandbox down -v --remove-orphans >/dev/null 2>&1 || true
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

wait_for_novnc() {
  echo "[smoke] waiting for noVNC"
  for _ in $(seq 1 120); do
    if curl -fsS "http://localhost:6080/vnc.html" >/dev/null 2>&1; then
      echo "[smoke] noVNC ok"
      return 0
    fi
    sleep 1
  done
  echo "[smoke] noVNC did not become ready"
  docker compose logs desktop-sandbox || true
  return 1
}

echo "[smoke] starting docker compose (desktop-sandbox profile)"
docker compose --profile desktop-sandbox up -d --build tyrum desktop-sandbox

wait_for_healthz
wait_for_novnc

docker compose exec -T -w /app/packages/gateway tyrum node --input-type=module -e '
  import Database from "better-sqlite3";
  import { readFileSync } from "node:fs";
  import { randomUUID } from "node:crypto";
  import { CAPABILITY_DESCRIPTOR_DEFAULT_VERSION, descriptorIdForClientCapability } from "@tyrum/schemas";

  const baseUrl = "http://127.0.0.1:8788";
  const token = readFileSync("/var/lib/tyrum/.admin-token", "utf8").trim();
  if (!token) throw new Error("[smoke] admin token is empty");

  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  async function fetchJson(path, init) {
    const res = await fetch(`${baseUrl}${path}`, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      throw new Error(`[smoke] ${path} failed: status=${res.status} body=${text}`);
    }
    return await res.json();
  }

  async function sleep(ms) {
    await new Promise((r) => setTimeout(r, ms));
  }

  async function waitForPendingPairing() {
    const deadlineMs = Date.now() + 60_000;
    for (;;) {
      const data = await fetchJson("/pairings?status=pending", { headers });
      const pairings = Array.isArray(data.pairings) ? data.pairings : [];
      const pairing =
        pairings.find((p) => Array.isArray(p?.node?.capabilities) && p.node.capabilities.includes("desktop")) ??
        pairings[0];
      if (pairing) return pairing;
      if (Date.now() > deadlineMs) throw new Error("[smoke] timed out waiting for pending pairing");
      await sleep(1000);
    }
  }

  const pairing = await waitForPendingPairing();
  const pairingId = pairing?.pairing_id;
  if (typeof pairingId !== "number" || pairingId <= 0) {
    throw new Error(`[smoke] invalid pairing_id: ${String(pairingId)}`);
  }

  const desktopDescriptorId = descriptorIdForClientCapability("desktop");

  console.log(
    `[smoke] pending pairing: id=${pairingId} node_id=${pairing?.node?.node_id ?? "<missing>"} label=${pairing?.node?.label ?? "<none>"}`,
  );

  await fetchJson(`/pairings/${pairingId}/approve`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      trust_level: "local",
      capability_allowlist: [
        { id: desktopDescriptorId, version: CAPABILITY_DESCRIPTOR_DEFAULT_VERSION },
      ],
    }),
  });

  console.log(`[smoke] pairing approved: ${pairingId}`);

  const workflowRes = await fetch(`${baseUrl}/workflow/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      key: "agent:default:smoke:desktop-sandbox",
      lane: "main",
      plan_id: "smoke-desktop-sandbox",
      request_id: `req-smoke-${randomUUID()}`,
      steps: [
        {
          type: "Desktop",
          args: { op: "snapshot", include_tree: false },
          idempotency_key: `smoke-${randomUUID()}`,
        },
      ],
    }),
  });

  if (!workflowRes.ok) {
    const text = await workflowRes.text().catch(() => "<no body>");
    throw new Error(`[smoke] workflow.run failed: status=${workflowRes.status} body=${text}`);
  }

  const workflowData = await workflowRes.json();
  const runId = workflowData.run_id;
  if (typeof runId !== "string" || runId.length === 0) {
    throw new Error(`[smoke] workflow.run response missing run_id: ${JSON.stringify(workflowData)}`);
  }

  const dbPath = process.env.GATEWAY_DB_PATH;
  if (!dbPath) throw new Error("GATEWAY_DB_PATH is not set in tyrum service");

  const db = new Database(dbPath);
  try {
    const deadlineMs = Date.now() + 180_000;
    for (;;) {
      const row = db.prepare("SELECT status, paused_reason FROM execution_runs WHERE run_id = ?").get(runId);
      const status = row?.status;

      if (status === "succeeded") {
        console.log(`[smoke] run ${runId} succeeded`);
        break;
      }
      if (status === "failed" || status === "cancelled") {
        throw new Error(`[smoke] run ${runId} ended with status=${status}`);
      }
      if (status === "paused") {
        const pausedReason = row?.paused_reason;
        if (pausedReason !== "policy") {
          throw new Error(`[smoke] run ${runId} paused unexpectedly: reason=${pausedReason ?? "<none>"}`);
        }

        const approval = db
          .prepare(
            "SELECT id FROM approvals WHERE run_id = ? AND status = ? AND kind = ? ORDER BY id ASC LIMIT 1",
          )
          .get(runId, "pending", "policy");
        const approvalId = approval?.id;
        if (typeof approvalId !== "number") {
          throw new Error(`[smoke] run ${runId} paused for policy but no pending approval found`);
        }

        await fetchJson(`/approvals/${approvalId}/respond`, {
          method: "POST",
          headers,
          body: JSON.stringify({ decision: "approved" }),
        });
        console.log(`[smoke] approved policy gate: run_id=${runId} approval_id=${approvalId}`);
      }

      if (Date.now() > deadlineMs) {
        throw new Error(
          `[smoke] timed out waiting for run ${runId} to complete (status=${status ?? "<missing>"} paused_reason=${row?.paused_reason ?? "<none>"})`,
        );
      }

      await sleep(1000);
    }
  } finally {
    db.close();
  }

  console.log(`SMOKE_RUN_ID=${runId}`);
'
