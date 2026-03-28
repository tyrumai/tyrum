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
  function BatchV1Api() {}
  function CoreV1Api() {}

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

describe("KubernetesToolRunnerStepExecutor hardening", () => {
  const originalKubernetesServiceHost = process.env["KUBERNETES_SERVICE_HOST"];

  beforeEach(() => {
    createdJobBody = undefined;
    vi.clearAllMocks();
    delete process.env["KUBERNETES_SERVICE_HOST"];
  });

  afterEach(() => {
    if (originalKubernetesServiceHost === undefined) {
      delete process.env["KUBERNETES_SERVICE_HOST"];
    } else {
      process.env["KUBERNETES_SERVICE_HOST"] = originalKubernetesServiceHost;
    }
  });

  it("applies baseline pod/container security context by default", async () => {
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
      { type: "Desktop", args: { op: "screenshot" } },
      "plan-1",
      0,
      1_000,
      {
        runId: "run-1",
        stepId: "step-1",
        attemptId: "attempt-1",
        approvalId: null,
        key: "k",
        workspaceId: "default",
        policySnapshotId: null,
      },
    );

    expect(result.success).toBe(true);
    expect(createdJobBody).toBeTruthy();

    const podSpec = createdJobBody.spec.template.spec;
    expect(podSpec.securityContext).toMatchObject({
      runAsNonRoot: true,
      runAsUser: 10001,
      runAsGroup: 10001,
      fsGroup: 10001,
      seccompProfile: { type: "RuntimeDefault" },
    });

    const container = podSpec.containers[0];
    expect(container.securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
      runAsNonRoot: true,
    });

    expect(container.securityContext).not.toHaveProperty("readOnlyRootFilesystem", true);
    expect(podSpec.volumes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "tmp" })]),
    );
    expect(container.volumeMounts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "tmp" })]),
    );
  });

  it("enables hardened profile with read-only rootfs and /tmp mount", async () => {
    const { createKubernetesToolRunnerStepExecutor } =
      await import("../../src/modules/execution/kubernetes-toolrunner-step-executor.js");

    const executor = createKubernetesToolRunnerStepExecutor({
      namespace: "default",
      image: "tyrum/gateway:dev",
      workspacePvcClaim: "workspace",
      tyrumHome: "/var/lib/tyrum",
      dbPath: "postgres://user:pass@localhost:5432/test",
      hardeningProfile: "hardened",
      deleteJobAfter: false,
    });

    const result = await executor.execute(
      { type: "Desktop", args: { op: "screenshot" } },
      "plan-1",
      0,
      1_000,
      {
        runId: "run-1",
        stepId: "step-1",
        attemptId: "attempt-1",
        approvalId: null,
        key: "k",
        workspaceId: "default",
        policySnapshotId: null,
      },
    );

    expect(result.success).toBe(true);
    expect(createdJobBody).toBeTruthy();

    const podSpec = createdJobBody.spec.template.spec;
    const container = podSpec.containers[0];

    expect(container.securityContext).toMatchObject({
      readOnlyRootFilesystem: true,
    });

    expect(podSpec.automountServiceAccountToken).toBe(false);
    expect(podSpec.enableServiceLinks).toBe(false);

    expect(podSpec.volumes).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "tmp" })]),
    );

    expect(container.volumeMounts).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "tmp", mountPath: "/tmp" })]),
    );
  });
});
