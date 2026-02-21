/**
 * Presence and status routes.
 *
 * Presence is an operator-facing, best-effort view of connected instances.
 */

import { Hono } from "hono";
import { GatewayStatusResponse, PresenceMode, PresenceRole, type GatewayRole } from "@tyrum/schemas";
import type { PresenceDal } from "../modules/presence/dal.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { SqlDb } from "../statestore/types.js";
import { PolicyBundleService } from "../modules/policy-bundle/service.js";
import { ContextReportDal } from "../modules/observability/context-report-dal.js";
import type { AgentRuntime } from "../modules/agent/runtime.js";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

export interface PresenceRouteOptions {
  db: SqlDb;
  presenceDal: PresenceDal;
  instanceId: string;
  startedAtMs: number;
  role: GatewayRole;
  version: string;
  modelGatewayConfigPath?: string;
  agentRuntime?: Pick<AgentRuntime, "status">;
  connectionManager?: ConnectionManager;
}

export function createPresenceRoutes(opts: PresenceRouteOptions): Hono {
  const app = new Hono();
  const policyBundleService = new PolicyBundleService(opts.db);
  const contextReportDal = new ContextReportDal(opts.db);

  app.get("/presence", async (c) => {
    const roleRaw = c.req.query("role")?.trim();
    const modeRaw = c.req.query("mode")?.trim();
    const limitRaw = c.req.query("limit")?.trim();
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 250;
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(1_000, limit)) : 250;

    const role = roleRaw && PresenceRole.safeParse(roleRaw).success ? roleRaw : undefined;
    const mode = modeRaw && PresenceMode.safeParse(modeRaw).success ? modeRaw : undefined;

    const entries = await opts.presenceDal.list({ limit: safeLimit });
    const filtered = entries.filter((e) => {
      if (role && e.role !== role) return false;
      if (mode && e.mode !== mode) return false;
      return true;
    });

    return c.json({ entries: filtered });
  });

  function resolveToolrunnerLauncher(): "local" | "kubernetes" {
    const launcherRaw = process.env["TYRUM_TOOLRUNNER_LAUNCHER"]?.trim().toLowerCase();
    const isKubernetesRuntime = Boolean(process.env["KUBERNETES_SERVICE_HOST"]);
    const launcher = launcherRaw || (isKubernetesRuntime ? "kubernetes" : "local");
    return launcher === "kubernetes" ? "kubernetes" : "local";
  }

  function resolvePolicyMode(): "enforcing" | "disabled" {
    const raw = process.env["TYRUM_POLICY_MODE"]?.trim().toLowerCase();
    return raw === "disabled" ? "disabled" : "enforcing";
  }

  function resolveSandboxMode(): "default" | "hardened" {
    const raw = process.env["TYRUM_SANDBOX_MODE"]?.trim().toLowerCase();
    return raw === "hardened" ? "hardened" : "default";
  }

  function resolveElevatedExecutionAvailable(): boolean {
    const raw = process.env["TYRUM_ELEVATED_EXECUTION"]?.trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
  }

  function parseModelGatewayMetadata(
    configPath: string,
    modelName: string,
  ): { provider?: string; authProfile?: string } {
    const raw = readFileSync(configPath, "utf8");
    const cfg = (parseYaml(raw) ?? {}) as Record<string, unknown>;
    const models = (cfg["models"] ?? {}) as Record<string, unknown>;
    const modelCfg = (models[modelName] ?? {}) as Record<string, unknown>;
    const provider = typeof modelCfg["target"] === "string" ? modelCfg["target"] : undefined;
    const authProfile =
      typeof modelCfg["auth_profile"] === "string" ? modelCfg["auth_profile"] : undefined;
    return { provider, authProfile };
  }

  app.get("/status", async (c) => {
    const nowMs = Date.now();
    const uptimeMs = Math.max(0, nowMs - opts.startedAtMs);
    const presenceCount = await opts.presenceDal.count();

    const [policySnapshot, lastContextReport] = await Promise.all([
      policyBundleService
        .getOrCreateDeploymentSnapshot(opts.instanceId)
        .catch(() => null),
      contextReportDal.latest().catch(() => undefined),
    ]);

    const queuedJobsRow = await opts.db
      .get<{ n: number | string }>("SELECT COUNT(*) AS n FROM execution_jobs WHERE status = 'queued'")
      .catch(() => undefined);
    const runningJobsRow = await opts.db
      .get<{ n: number | string }>("SELECT COUNT(*) AS n FROM execution_jobs WHERE status = 'running'")
      .catch(() => undefined);
    const pausedRunsRow = await opts.db
      .get<{ n: number | string }>("SELECT COUNT(*) AS n FROM execution_runs WHERE status = 'paused'")
      .catch(() => undefined);

    const queuedJobs = queuedJobsRow ? Number(queuedJobsRow.n) : 0;
    const runningJobs = runningJobsRow ? Number(runningJobsRow.n) : 0;
    const pausedRuns = pausedRunsRow ? Number(pausedRunsRow.n) : 0;

    const activeRun = await opts.db
      .get<{
        run_id: string;
        job_id: string;
        key: string;
        lane: string;
        status: string;
      }>(
        `SELECT run_id, job_id, key, lane, status
         FROM execution_runs
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .catch(() => undefined);

    const agentStatus = opts.agentRuntime ? await opts.agentRuntime.status(true) : undefined;
    const modelName = agentStatus?.enabled ? agentStatus.model.model : undefined;
    const baseUrl = agentStatus?.enabled ? agentStatus.model.base_url : undefined;

    let provider: string | undefined;
    let authProfile: string | undefined;
    if (modelName && opts.modelGatewayConfigPath) {
      try {
        const meta = parseModelGatewayMetadata(opts.modelGatewayConfigPath, modelName);
        provider = meta.provider;
        authProfile = meta.authProfile;
      } catch {
        // best-effort
      }
    }

    const launcher = resolveToolrunnerLauncher();
    const policyMode = resolvePolicyMode();
    const sandboxMode = resolveSandboxMode();

    const lastReportSummary = lastContextReport
      ? {
          context_report_id: lastContextReport.context_report_id,
          plan_id: lastContextReport.plan_id,
          created_at: lastContextReport.created_at,
          total_bytes: lastContextReport.totals.total_bytes,
          total_est_tokens: lastContextReport.totals.total_est_tokens,
        }
      : null;

    const connectionStats = opts.connectionManager?.getStats();

    const status = GatewayStatusResponse.parse({
      instance_id: opts.instanceId,
      role: opts.role,
      version: opts.version,
      now: new Date(nowMs).toISOString(),
      uptime_ms: uptimeMs,
      model: modelName
        ? {
            configured: true,
            model: modelName,
            base_url: baseUrl,
            provider,
            auth_profile: authProfile,
          }
        : { configured: false },
      execution: {
        queued_jobs: Number.isFinite(queuedJobs) ? Math.max(0, queuedJobs) : 0,
        running_jobs: Number.isFinite(runningJobs) ? Math.max(0, runningJobs) : 0,
        paused_runs: Number.isFinite(pausedRuns) ? Math.max(0, pausedRuns) : 0,
        active_run: activeRun
          ? {
              run_id: activeRun.run_id,
              job_id: activeRun.job_id,
              key: activeRun.key,
              lane: activeRun.lane,
              status: activeRun.status,
            }
          : null,
      },
      policy: {
        mode: policyMode,
        snapshot_id: policySnapshot?.policySnapshotId,
        snapshot_hash: policySnapshot?.contentHash,
      },
      sandbox: {
        mode: sandboxMode,
        elevated_execution_available: resolveElevatedExecutionAvailable(),
      },
      toolrunner: {
        launcher,
      },
      context: {
        estimated: lastContextReport
          ? {
              total_bytes: lastContextReport.totals.total_bytes,
              total_est_tokens: lastContextReport.totals.total_est_tokens,
            }
          : { total_bytes: 0, total_est_tokens: 0 },
        last_report: lastReportSummary,
      },
      presence: { count: presenceCount },
      connections: connectionStats
        ? {
            total_clients: connectionStats.totalClients,
            capability_counts: connectionStats.capabilityCounts,
          }
        : null,
    });

    return c.json(status);
  });

  return app;
}
