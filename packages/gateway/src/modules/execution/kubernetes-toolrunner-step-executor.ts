import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/schemas";
import { BatchV1Api, CoreV1Api, KubeConfig } from "@kubernetes/client-node";
import { randomUUID } from "node:crypto";
import type { Logger } from "../observability/logger.js";
import type { SandboxHardeningProfile } from "../sandbox/hardening.js";
import type { StepExecutionContext, StepExecutor, StepResult } from "./engine.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sanitizeDnsLabelSuffix(raw: string): string {
  const s = raw.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return s.replace(/^-+/, "").replace(/-+$/, "");
}

function unwrapBody<T>(res: unknown): T {
  const anyRes = res as { body?: T };
  return (anyRes && typeof anyRes === "object" && "body" in anyRes ? anyRes.body : res) as T;
}

export function parseStepResultFromLogs(raw: string): StepResult | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    try {
      const parsed = JSON.parse(line) as StepResult;
      if (parsed && typeof parsed === "object" && typeof parsed.success === "boolean") {
        return parsed;
      }
    } catch (err) {
      // Intentional: toolrunner logs can contain non-JSON lines; keep scanning.
      void err;
    }
  }
  return null;
}

export interface KubernetesToolRunnerStepExecutorOptions {
  namespace: string;
  image: string;
  workspacePvcClaim: string;
  tyrumHome: string;
  dbPath: string;
  hardeningProfile: SandboxHardeningProfile;
  logger?: Logger;
  /**
   * Whether to delete the job after reading logs.
   * Defaults to true (best-effort).
   */
  deleteJobAfter?: boolean;
  /** TTLSecondsAfterFinished for the Job (if supported). */
  jobTtlSeconds?: number;
  /** Optional service account name for ToolRunner pods. */
  serviceAccountName?: string;
}

export function createKubernetesToolRunnerStepExecutor(
  opts: KubernetesToolRunnerStepExecutorOptions,
): StepExecutor {
  return new KubernetesToolRunnerStepExecutor(opts);
}

class KubernetesToolRunnerStepExecutor implements StepExecutor {
  private readonly namespace: string;
  private readonly image: string;
  private readonly workspacePvcClaim: string;
  private readonly tyrumHome: string;
  private readonly dbPath: string;
  private readonly hardeningProfile: SandboxHardeningProfile;
  private readonly logger?: Logger;
  private readonly deleteJobAfter: boolean;
  private readonly jobTtlSeconds?: number;
  private readonly serviceAccountName?: string;

  private readonly batch: BatchV1Api;
  private readonly core: CoreV1Api;

  constructor(opts: KubernetesToolRunnerStepExecutorOptions) {
    this.namespace = opts.namespace;
    this.image = opts.image;
    this.workspacePvcClaim = opts.workspacePvcClaim;
    this.tyrumHome = opts.tyrumHome;
    this.dbPath = opts.dbPath;
    this.hardeningProfile = opts.hardeningProfile;
    this.logger = opts.logger;
    this.deleteJobAfter = opts.deleteJobAfter ?? true;
    this.jobTtlSeconds = opts.jobTtlSeconds;
    this.serviceAccountName = opts.serviceAccountName;

    const kc = new KubeConfig();
    if (process.env["KUBERNETES_SERVICE_HOST"]) {
      kc.loadFromCluster();
    } else {
      kc.loadFromDefault();
    }
    this.batch = kc.makeApiClient(BatchV1Api);
    this.core = kc.makeApiClient(CoreV1Api);
  }

  async execute(
    action: ActionPrimitiveT,
    planId: string,
    stepIndex: number,
    timeoutMs: number,
    context: StepExecutionContext,
  ): Promise<StepResult> {
    const hardeningProfile = this.hardeningProfile;
    const suffix = sanitizeDnsLabelSuffix(randomUUID().replace(/-/g, "").slice(0, 10));
    const jobName = `tyrum-toolrunner-${suffix}`.slice(0, 63);

    const payload = JSON.stringify({
      tenant_id: context.tenantId,
      plan_id: planId,
      step_index: stepIndex,
      timeout_ms: timeoutMs,
      action,
    });
    const payloadB64 = Buffer.from(payload, "utf-8").toString("base64url");
    const args = [
      "toolrunner",
      "--home",
      this.tyrumHome,
      "--db",
      this.dbPath,
      "--payload-b64",
      payloadB64,
    ];

    const podSecurityContext = {
      runAsNonRoot: true,
      runAsUser: 10001,
      runAsGroup: 10001,
      fsGroup: 10001,
      seccompProfile: { type: "RuntimeDefault" },
    };

    const containerSecurityContext = {
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
      runAsNonRoot: true,
      ...(hardeningProfile === "hardened" ? { readOnlyRootFilesystem: true } : {}),
    };

    const workspaceMount = {
      name: "workspace",
      mountPath: this.tyrumHome,
    };

    const volumeMounts =
      hardeningProfile === "hardened"
        ? [workspaceMount, { name: "tmp", mountPath: "/tmp" }]
        : [workspaceMount];

    const volumes =
      hardeningProfile === "hardened"
        ? [
            {
              name: "workspace",
              persistentVolumeClaim: {
                claimName: this.workspacePvcClaim,
              },
            },
            { name: "tmp", emptyDir: {} },
          ]
        : [
            {
              name: "workspace",
              persistentVolumeClaim: {
                claimName: this.workspacePvcClaim,
              },
            },
          ];

    const job = {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: {
        name: jobName,
        namespace: this.namespace,
        labels: {
          "app.kubernetes.io/name": "tyrum",
          "app.kubernetes.io/component": "toolrunner",
        },
      },
      spec: {
        ttlSecondsAfterFinished: this.jobTtlSeconds,
        backoffLimit: 0,
        template: {
          metadata: {
            labels: {
              "app.kubernetes.io/name": "tyrum",
              "app.kubernetes.io/component": "toolrunner",
            },
          },
          spec: {
            serviceAccountName: this.serviceAccountName,
            automountServiceAccountToken: hardeningProfile === "hardened" ? false : undefined,
            enableServiceLinks: hardeningProfile === "hardened" ? false : undefined,
            restartPolicy: "Never",
            securityContext: podSecurityContext,
            containers: [
              {
                name: "toolrunner",
                image: this.image,
                args,
                securityContext: containerSecurityContext,
                volumeMounts,
              },
            ],
            volumes,
          },
        },
      },
    };

    try {
      await this.batch.createNamespacedJob({
        namespace: this.namespace,
        body: job,
      });

      const deadlineMs = Date.now() + Math.max(1, timeoutMs) + 60_000;

      for (;;) {
        const statusRes = await this.batch.readNamespacedJobStatus({
          namespace: this.namespace,
          name: jobName,
        });
        const status = unwrapBody<{ status?: { succeeded?: number; failed?: number } }>(
          statusRes,
        ).status;

        if ((status?.succeeded ?? 0) >= 1) break;
        if ((status?.failed ?? 0) >= 1) {
          const logs = await this.tryReadJobLogs(jobName).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            this.logger?.warn("toolrunner.k8s.logs_read_failed", {
              run_id: context.runId,
              step_id: context.stepId,
              attempt_id: context.attemptId,
              job: jobName,
              error: message,
            });
            return "";
          });
          const parsed = logs ? parseStepResultFromLogs(logs) : null;
          return (
            parsed ?? {
              success: false,
              error: "toolrunner job failed",
            }
          );
        }

        if (Date.now() >= deadlineMs) {
          return { success: false, error: "toolrunner job timed out" };
        }

        await sleep(1_000);
      }

      const logs = await this.tryReadJobLogs(jobName);
      const parsed = parseStepResultFromLogs(logs);
      if (!parsed) {
        this.logger?.warn("toolrunner.k8s.invalid_logs", { job: jobName });
        return { success: false, error: "toolrunner produced no StepResult JSON" };
      }
      return parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.error("toolrunner.k8s.error", { error: message });
      return { success: false, error: message };
    } finally {
      if (this.deleteJobAfter) {
        try {
          await this.batch.deleteNamespacedJob({
            namespace: this.namespace,
            name: jobName,
            propagationPolicy: "Background",
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger?.warn("toolrunner.k8s.delete_job_failed", {
            run_id: context.runId,
            step_id: context.stepId,
            attempt_id: context.attemptId,
            job: jobName,
            error: message,
          });
        }
      }
    }
  }

  private async tryReadJobLogs(jobName: string): Promise<string> {
    const podsRes = await this.core.listNamespacedPod({
      namespace: this.namespace,
      labelSelector: `job-name=${jobName}`,
    });
    const pods =
      unwrapBody<{ items?: Array<{ metadata?: { name?: string } }> }>(podsRes).items ?? [];
    const podName = pods[0]?.metadata?.name;
    if (!podName) {
      return "";
    }

    const logsRes = await this.core.readNamespacedPodLog({
      namespace: this.namespace,
      name: podName,
      container: "toolrunner",
    });
    const logs = unwrapBody<string>(logsRes);
    return typeof logs === "string" ? logs : String(logs);
  }
}
