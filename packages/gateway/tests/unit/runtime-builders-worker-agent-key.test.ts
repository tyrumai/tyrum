import { DeploymentConfig } from "@tyrum/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StepExecutionContext } from "../../src/modules/execution/engine.js";

type DecideExecutorInput = {
  request: {
    channel: string;
    thread_id: string;
    message: string;
  };
  planId: string;
  stepIndex: number;
  timeoutMs: number;
  context: StepExecutionContext;
};

type DecideExecutor = (
  input: DecideExecutorInput,
) => Promise<{ success: boolean; result: unknown }>;

describe("createWorkerLoop runtime selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it(
    "resolves decide runtimes from the execution key instead of run.agent_id",
    { timeout: 15_000 },
    async () => {
      vi.resetModules();

      let decideExecutor: DecideExecutor | undefined;
      const executeDecideAction = vi.fn(async () => ({
        reply: "",
        conversation_id: "conversation-1",
      }));
      const getRuntime = vi.fn(async () => ({ executeDecideAction }));

      vi.doMock("../../src/modules/execution/toolrunner-step-executor.js", () => ({
        createToolRunnerStepExecutor: vi.fn(() => ({ kind: "toolrunner" })),
      }));

      vi.doMock("../../src/modules/execution/kubernetes-toolrunner-step-executor.js", () => ({
        createKubernetesToolRunnerStepExecutor: vi.fn(() => ({ kind: "kubernetes-toolrunner" })),
      }));

      vi.doMock("../../src/modules/execution/node-dispatch-step-executor.js", () => ({
        createNodeDispatchStepExecutor: vi.fn(({ fallback }: { fallback: unknown }) => fallback),
      }));

      vi.doMock("@tyrum/runtime-node-control", () => ({
        NodeDispatchService: function NodeDispatchService() {},
      }));

      vi.doMock("../../src/modules/execution/gateway-step-executor.js", () => ({
        createGatewayStepExecutor: vi.fn((opts: { decideExecutor?: DecideExecutor }) => {
          decideExecutor = opts.decideExecutor;
          return { kind: "gateway-step-executor" };
        }),
      }));

      vi.doMock("../../src/modules/execution/worker-loop.js", () => ({
        startExecutionWorkerLoop: vi.fn(() => ({
          stop: vi.fn(),
          done: Promise.resolve(),
        })),
      }));

      vi.doMock("../../src/bootstrap/entrypoint-path.js", () => ({
        resolveGatewayEntrypointPath: vi.fn(() => "/tmp/tyrum-entrypoint"),
      }));

      const { createWorkerLoop } = await import("../../src/bootstrap/runtime-builders.js");

      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const context = {
        shouldRunWorker: true,
        deploymentConfig: DeploymentConfig.parse({}),
        dbPath: ":memory:",
        tyrumHome: "/tmp/tyrum-home",
        migrationsDir: "/tmp/tyrum-migrations",
        container: {
          db: {},
          artifactStore: {},
        },
        logger,
        instanceId: "worker-1",
      } as const;
      const protocol = {
        protocolDeps: {
          agents: { getRuntime },
        },
      } as const;

      expect(createWorkerLoop(context as never, protocol as never)).toBeDefined();
      expect(decideExecutor).toBeDefined();
      if (!decideExecutor) {
        throw new Error("expected createWorkerLoop to wire a decide executor");
      }

      await decideExecutor({
        request: {
          channel: "automation:default",
          thread_id: "schedule-1",
          message: "Run the heartbeat.",
        },
        planId: "plan-1",
        stepIndex: 0,
        timeoutMs: 5_000,
        context: {
          tenantId: "tenant-1",
          turnId: "run-1",
          stepId: "step-1",
          attemptId: "attempt-1",
          approvalId: null,
          agentId: "00000000-0000-4000-8000-000000000002",
          key: "agent:default:main",
          workspaceId: "workspace-1",
          policySnapshotId: null,
        },
      });

      expect(getRuntime).toHaveBeenCalledOnce();
      expect(getRuntime).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        agentKey: "default",
      });
      expect(executeDecideAction).toHaveBeenCalledOnce();
    },
  );

  it(
    "keeps gateway and node-dispatch wrapping when the toolrunner launcher is kubernetes",
    { timeout: 15_000 },
    async () => {
      vi.resetModules();

      let decideExecutor: DecideExecutor | undefined;
      const createNodeDispatchStepExecutor = vi.fn(
        ({ fallback }: { fallback: unknown }) => fallback,
      );
      const createGatewayStepExecutor = vi.fn((opts: { decideExecutor?: DecideExecutor }) => {
        decideExecutor = opts.decideExecutor;
        return { kind: "gateway-step-executor" };
      });

      vi.doMock("../../src/modules/execution/toolrunner-step-executor.js", () => ({
        createToolRunnerStepExecutor: vi.fn(() => ({ kind: "toolrunner" })),
      }));

      const createKubernetesToolRunnerStepExecutor = vi.fn(() => ({
        kind: "kubernetes-toolrunner",
      }));
      vi.doMock("../../src/modules/execution/kubernetes-toolrunner-step-executor.js", () => ({
        createKubernetesToolRunnerStepExecutor,
      }));

      vi.doMock("../../src/modules/execution/node-dispatch-step-executor.js", () => ({
        createNodeDispatchStepExecutor,
      }));

      vi.doMock("@tyrum/runtime-node-control", () => ({
        NodeDispatchService: function NodeDispatchService() {},
      }));

      vi.doMock("../../src/modules/execution/gateway-step-executor.js", () => ({
        createGatewayStepExecutor,
      }));

      vi.doMock("../../src/modules/execution/worker-loop.js", () => ({
        startExecutionWorkerLoop: vi.fn(() => ({
          stop: vi.fn(),
          done: Promise.resolve(),
        })),
      }));

      vi.doMock("../../src/bootstrap/entrypoint-path.js", () => ({
        resolveGatewayEntrypointPath: vi.fn(() => "/tmp/tyrum-entrypoint"),
      }));

      const { createWorkerLoop } = await import("../../src/bootstrap/runtime-builders.js");

      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      const context = {
        shouldRunWorker: true,
        deploymentConfig: DeploymentConfig.parse({
          execution: {
            toolrunner: {
              launcher: "kubernetes",
              namespace: "tyrum",
              image: "ghcr.io/tyrum/toolrunner:test",
              workspacePvcClaim: "workspace-pvc",
            },
          },
        }),
        dbPath: "postgres://user:pass@localhost:5432/test",
        tyrumHome: "/tmp/tyrum-home",
        migrationsDir: "/tmp/tyrum-migrations",
        container: {
          db: {},
          artifactStore: {},
        },
        logger,
        instanceId: "worker-1",
      } as const;
      const protocol = {
        protocolDeps: {
          agents: undefined,
        },
      } as const;

      expect(createWorkerLoop(context as never, protocol as never)).toBeDefined();
      expect(createKubernetesToolRunnerStepExecutor).toHaveBeenCalledOnce();
      expect(createNodeDispatchStepExecutor).toHaveBeenCalledOnce();
      expect(createGatewayStepExecutor).toHaveBeenCalledOnce();
      expect(decideExecutor).toBeUndefined();
    },
  );
});
