import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let createdJobBody: any;

const batchClient = {
  createNamespacedJob: vi.fn(async (input: { body: unknown }) => {
    createdJobBody = input.body;
    return { body: {} };
  }),
  readNamespacedJobStatus: vi.fn(async () => ({ body: { status: { succeeded: 1 } } })),
  deleteNamespacedJob: vi.fn(async () => ({ body: {} })),
};

const coreClient = {
  listNamespacedPod: vi.fn(async () => ({ body: { items: [{ metadata: { name: "pod-1" } }] } })),
  readNamespacedPodLog: vi.fn(async () => `{"success":true}\n`),
};

vi.mock("@kubernetes/client-node", () => {
  class BatchV1Api {}
  class CoreV1Api {}

  class KubeConfig {
    loadFromCluster(): void {
      // no-op
    }
    loadFromDefault(): void {
      // no-op
    }
    makeApiClient(api: unknown): unknown {
      if (api === BatchV1Api) return batchClient;
      if (api === CoreV1Api) return coreClient;
      throw new Error("unexpected api client");
    }
  }

  return { BatchV1Api, CoreV1Api, KubeConfig };
});

beforeEach(() => {
  createdJobBody = undefined;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Kubernetes toolrunner step executor", () => {
  it("sanitizeDnsLabelSuffix lowercases, replaces invalid chars, and trims hyphens", async () => {
    const { sanitizeDnsLabelSuffix } =
      await import("../../src/modules/execution/kubernetes-toolrunner-step-executor.js");

    expect(sanitizeDnsLabelSuffix("--My_Suffix!!--")).toBe("my-suffix");
  });

  it("sanitizeDnsLabelSuffix returns empty string when the label is entirely invalid", async () => {
    const { sanitizeDnsLabelSuffix } =
      await import("../../src/modules/execution/kubernetes-toolrunner-step-executor.js");

    expect(sanitizeDnsLabelSuffix("---")).toBe("");
    expect(sanitizeDnsLabelSuffix("___")).toBe("");
  });

  it("parseStepResultFromLogs returns the last valid StepResult JSON", async () => {
    const { parseStepResultFromLogs } =
      await import("../../src/modules/execution/kubernetes-toolrunner-step-executor.js");

    const parsed = parseStepResultFromLogs(
      [
        "hello",
        JSON.stringify({ success: true }),
        JSON.stringify({ nope: true }),
        JSON.stringify({ success: false, error: "nope" }),
      ].join("\n"),
    );

    expect(parsed).toEqual({ success: false, error: "nope" });
  });

  it("parseStepResultFromLogs returns null when no StepResult JSON is present", async () => {
    const { parseStepResultFromLogs } =
      await import("../../src/modules/execution/kubernetes-toolrunner-step-executor.js");

    expect(parseStepResultFromLogs("hello\n")).toBeNull();
    expect(parseStepResultFromLogs(JSON.stringify({ nope: true }))).toBeNull();
  });

  it("creates a Job and returns parsed StepResult from logs on success", async () => {
    const { createKubernetesToolRunnerStepExecutor } =
      await import("../../src/modules/execution/kubernetes-toolrunner-step-executor.js");

    const executor = createKubernetesToolRunnerStepExecutor({
      namespace: "default",
      image: "tyrum/gateway:dev",
      workspacePvcClaim: "workspace",
      tyrumHome: "/var/lib/tyrum",
      dbPath: "postgres://user:pass@localhost:5432/test",
      hardeningProfile: "baseline",
      deleteJobAfter: false,
    });

    const result = await executor.execute(
      { type: "CLI", args: { cmd: "echo", args: ["hi"] } },
      "plan-1",
      0,
      1_000,
      {
        runId: "run-1",
        stepId: "step-1",
        attemptId: "attempt-1",
        approvalId: null,
        key: "k",
        lane: "main",
        workspaceId: "default",
        policySnapshotId: null,
      },
    );

    expect(result).toEqual({ success: true });
    expect(batchClient.createNamespacedJob).toHaveBeenCalledTimes(1);
    expect(createdJobBody.metadata.name).toMatch(/^tyrum-toolrunner-[a-z0-9-]+$/);
    expect(createdJobBody.metadata.name.length).toBeLessThanOrEqual(63);

    const container = createdJobBody.spec.template.spec.containers[0];
    expect(container.image).toBe("tyrum/gateway:dev");

    expect(container.args.slice(0, 6)).toEqual([
      "toolrunner",
      "--home",
      "/var/lib/tyrum",
      "--db",
      "postgres://user:pass@localhost:5432/test",
      "--payload-b64",
    ]);
    expect(container.args[6]).toSatisfy(
      (value: unknown) => typeof value === "string" && value.trim().length > 0,
      "payload-b64 arg is a non-empty string",
    );

    const payloadRaw = Buffer.from(container.args[6], "base64url").toString("utf-8");
    const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
    expect(payload["plan_id"]).toBe("plan-1");
    expect(payload["step_index"]).toBe(0);
    expect(payload["timeout_ms"]).toBe(1_000);
    expect(payload["action"]).toEqual({ type: "CLI", args: { cmd: "echo", args: ["hi"] } });

    const podSpec = createdJobBody.spec.template.spec;
    expect(podSpec.volumes).toHaveLength(1);
    expect(podSpec.volumes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "workspace",
          persistentVolumeClaim: { claimName: "workspace" },
        }),
      ]),
    );
    expect(podSpec.volumes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "tmp" })]),
    );

    expect(container.volumeMounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "workspace", mountPath: "/var/lib/tyrum" }),
      ]),
    );
    expect(container.volumeMounts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "tmp" })]),
    );
  });

  it("returns parsed StepResult from logs when the Job fails", async () => {
    const { createKubernetesToolRunnerStepExecutor } =
      await import("../../src/modules/execution/kubernetes-toolrunner-step-executor.js");

    batchClient.readNamespacedJobStatus.mockImplementationOnce(async () => ({
      body: { status: { failed: 1 } },
    }));
    coreClient.readNamespacedPodLog.mockImplementationOnce(
      async () => `{"success":false,"error":"boom"}\n`,
    );

    const executor = createKubernetesToolRunnerStepExecutor({
      namespace: "default",
      image: "tyrum/gateway:dev",
      workspacePvcClaim: "workspace",
      tyrumHome: "/var/lib/tyrum",
      dbPath: "postgres://user:pass@localhost:5432/test",
      hardeningProfile: "baseline",
      deleteJobAfter: false,
    });

    const result = await executor.execute(
      { type: "CLI", args: { cmd: "echo", args: ["hi"] } },
      "plan-1",
      0,
      1_000,
      {
        runId: "run-1",
        stepId: "step-1",
        attemptId: "attempt-1",
        approvalId: null,
        key: "k",
        lane: "main",
        workspaceId: "default",
        policySnapshotId: null,
      },
    );

    expect(result).toEqual({ success: false, error: "boom" });
  });

  it("logs a warning when job logs cannot be read on failure", async () => {
    const { createKubernetesToolRunnerStepExecutor } =
      await import("../../src/modules/execution/kubernetes-toolrunner-step-executor.js");

    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
    };

    batchClient.readNamespacedJobStatus.mockImplementationOnce(async () => ({
      body: { status: { failed: 1 } },
    }));
    coreClient.readNamespacedPodLog.mockImplementationOnce(async () => {
      throw new Error("log read failed");
    });

    const executor = createKubernetesToolRunnerStepExecutor({
      namespace: "default",
      image: "tyrum/gateway:dev",
      workspacePvcClaim: "workspace",
      tyrumHome: "/var/lib/tyrum",
      dbPath: "postgres://user:pass@localhost:5432/test",
      hardeningProfile: "baseline",
      logger: logger as any,
      deleteJobAfter: false,
    });

    const result = await executor.execute(
      { type: "CLI", args: { cmd: "echo", args: ["hi"] } },
      "plan-1",
      0,
      1_000,
      {
        runId: "run-1",
        stepId: "step-1",
        attemptId: "attempt-1",
        approvalId: null,
        key: "k",
        lane: "main",
        workspaceId: "default",
        policySnapshotId: null,
      },
    );

    expect(result).toEqual({ success: false, error: "toolrunner job failed" });
    expect(logger.warn).toHaveBeenCalledWith(
      "toolrunner.k8s.logs_read_failed",
      expect.objectContaining({
        run_id: "run-1",
        step_id: "step-1",
        attempt_id: "attempt-1",
        job: expect.any(String),
      }),
    );
  });

  it("logs a warning when job deletion fails during cleanup", async () => {
    const { createKubernetesToolRunnerStepExecutor } =
      await import("../../src/modules/execution/kubernetes-toolrunner-step-executor.js");

    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
    };

    batchClient.deleteNamespacedJob.mockImplementationOnce(async () => {
      throw new Error("delete failed");
    });

    const executor = createKubernetesToolRunnerStepExecutor({
      namespace: "default",
      image: "tyrum/gateway:dev",
      workspacePvcClaim: "workspace",
      tyrumHome: "/var/lib/tyrum",
      dbPath: "postgres://user:pass@localhost:5432/test",
      hardeningProfile: "baseline",
      logger: logger as any,
      deleteJobAfter: true,
    });

    const result = await executor.execute(
      { type: "CLI", args: { cmd: "echo", args: ["hi"] } },
      "plan-1",
      0,
      1_000,
      {
        runId: "run-1",
        stepId: "step-1",
        attemptId: "attempt-1",
        approvalId: null,
        key: "k",
        lane: "main",
        workspaceId: "default",
        policySnapshotId: null,
      },
    );

    expect(result).toEqual({ success: true });
    expect(logger.warn).toHaveBeenCalledWith(
      "toolrunner.k8s.delete_job_failed",
      expect.objectContaining({
        run_id: "run-1",
        step_id: "step-1",
        attempt_id: "attempt-1",
        job: expect.any(String),
      }),
    );
  });
});
