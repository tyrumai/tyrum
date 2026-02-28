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
  it("buildEnv merges base and overrides (overrides win)", async () => {
    const { buildEnv } =
      await import("../../src/modules/execution/kubernetes-toolrunner-step-executor.js");

    const env = buildEnv({ FOO: "bar", OVERRIDE: "base" }, { OVERRIDE: "override", NEW: "x" });

    expect(Object.fromEntries(env.map((e) => [e.name, e.value]))).toEqual({
      FOO: "bar",
      OVERRIDE: "override",
      NEW: "x",
    });
  });

  it("buildEnv filters non-string and very large values", async () => {
    const { buildEnv } =
      await import("../../src/modules/execution/kubernetes-toolrunner-step-executor.js");

    const env = buildEnv(
      {
        SMALL: "ok",
        EXACT: "x".repeat(32_000),
        BIG: "x".repeat(32_001),
        UNDEF: undefined,
      },
      {},
    );

    expect(Object.fromEntries(env.map((e) => [e.name, e.value]))).toEqual({
      SMALL: "ok",
      EXACT: "x".repeat(32_000),
    });
  });

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
      env: { BASE: "1", BIG: "x".repeat(32_001) },
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
    expect(container.env).toEqual(
      expect.arrayContaining([
        { name: "BASE", value: "1" },
        expect.objectContaining({ name: "TYRUM_HOME" }),
      ]),
    );
    expect(container.env).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "BIG" })]),
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
});
