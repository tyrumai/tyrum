import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  combineDockerErrorMock,
  containerNameForEnvironmentMock,
  inspectContainerMock,
  loadOrCreateDesktopEnvironmentIdentityMock,
  readContainerLogsMock,
  readTakeoverUrlMock,
  removeContainerMock,
  runDockerMock,
} = vi.hoisted(() => ({
  combineDockerErrorMock: vi.fn((hint: string) => hint),
  containerNameForEnvironmentMock: vi.fn((environmentId: string) => `container-${environmentId}`),
  inspectContainerMock: vi.fn(),
  loadOrCreateDesktopEnvironmentIdentityMock: vi.fn(),
  readContainerLogsMock: vi.fn(async () => []),
  readTakeoverUrlMock: vi.fn(() => "http://127.0.0.1:6080/vnc.html?autoconnect=true"),
  removeContainerMock: vi.fn(async () => {}),
  runDockerMock: vi.fn(async () => ({ status: 0, stdout: "started\n", stderr: "" })),
}));

vi.mock("../../src/modules/desktop-environments/device-identity.js", () => ({
  loadOrCreateDesktopEnvironmentIdentity: loadOrCreateDesktopEnvironmentIdentityMock,
}));

vi.mock("../../src/modules/desktop-environments/docker-cli.js", () => ({
  combineDockerError: combineDockerErrorMock,
  containerNameForEnvironment: containerNameForEnvironmentMock,
  inspectContainer: inspectContainerMock,
  readContainerLogs: readContainerLogsMock,
  readTakeoverUrl: readTakeoverUrlMock,
  removeContainer: removeContainerMock,
  runDocker: runDockerMock,
}));

import { DesktopEnvironmentRuntimeManager } from "../../src/modules/desktop-environments/runtime-manager.js";

describe("DesktopEnvironmentRuntimeManager", () => {
  let tyrumHome: string;

  beforeEach(async () => {
    tyrumHome = await mkdtemp(join(tmpdir(), "tyrum-runtime-manager-"));

    loadOrCreateDesktopEnvironmentIdentityMock.mockImplementation(async (identityPath: string) => {
      const match =
        /desktop-environments\/([^/]+)\/node-home\/desktop-node\/device-identity\.json$/u.exec(
          identityPath,
        );
      const environmentId = match?.[1] ?? "unknown";
      return {
        deviceId: `device-${environmentId}`,
        publicKey: `public-${environmentId}`,
        privateKey: `private-${environmentId}`,
      };
    });

    const inspectCounts = new Map<string, number>();
    inspectContainerMock.mockImplementation(async (containerName: string) => {
      const count = inspectCounts.get(containerName) ?? 0;
      inspectCounts.set(containerName, count + 1);
      return count === 0
        ? null
        : {
            Config: { Image: "ghcr.io/tyrum/desktop:latest" },
            State: { Status: "running" },
          };
    });
  });

  afterEach(async () => {
    await rm(tyrumHome, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("uses separate identity state and pairing approvals per environment", async () => {
    const environmentDal = {
      listByHost: vi.fn(async () => [
        {
          tenant_id: "tenant-1",
          environment_id: "env-1",
          host_id: "host-1",
          label: "First",
          image_ref: "ghcr.io/tyrum/desktop:latest",
          managed_kind: "docker",
          status: "starting",
          desired_running: true,
          node_id: null,
          takeover_url: null,
          last_seen_at: null,
          last_error: null,
          created_at: "2026-03-12T00:00:00.000Z",
          updated_at: "2026-03-12T00:00:00.000Z",
        },
        {
          tenant_id: "tenant-1",
          environment_id: "env-2",
          host_id: "host-1",
          label: "Second",
          image_ref: "ghcr.io/tyrum/desktop:latest",
          managed_kind: "docker",
          status: "starting",
          desired_running: true,
          node_id: null,
          takeover_url: null,
          last_seen_at: null,
          last_error: null,
          created_at: "2026-03-12T00:00:00.000Z",
          updated_at: "2026-03-12T00:00:00.000Z",
        },
      ]),
      updateRuntime: vi.fn(async () => {}),
    };
    const nodePairingDal = {
      getByNodeId: vi.fn(async (nodeId: string) => ({
        pairing_id: nodeId === "device-env-1" ? 101 : 202,
        status: "pending",
      })),
      resolve: vi.fn(async () => ({ pairing: { status: "approved" } })),
    };
    const authTokens = {
      issueToken: vi.fn(async ({ deviceId }: { deviceId: string }) => ({
        token: `token-${deviceId}`,
      })),
    };
    const logger = { error: vi.fn() };

    const runtimeManager = new DesktopEnvironmentRuntimeManager(
      environmentDal as never,
      nodePairingDal as never,
      authTokens as never,
      logger as never,
      {
        hostId: "host-1",
        tyrumHome,
        gatewayPort: 8788,
      },
    );

    await runtimeManager.reconcileAll();

    expect(loadOrCreateDesktopEnvironmentIdentityMock).toHaveBeenNthCalledWith(
      1,
      join(
        tyrumHome,
        "desktop-environments",
        "env-1",
        "node-home",
        "desktop-node",
        "device-identity.json",
      ),
    );
    expect(loadOrCreateDesktopEnvironmentIdentityMock).toHaveBeenNthCalledWith(
      2,
      join(
        tyrumHome,
        "desktop-environments",
        "env-2",
        "node-home",
        "desktop-node",
        "device-identity.json",
      ),
    );

    expect(authTokens.issueToken).toHaveBeenCalledTimes(2);
    expect(authTokens.issueToken).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ deviceId: "device-env-1", tenantId: "tenant-1" }),
    );
    expect(authTokens.issueToken).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ deviceId: "device-env-2", tenantId: "tenant-1" }),
    );

    const runArgs = runDockerMock.mock.calls.map(([args]) => args as string[]);
    expect(runArgs).toContainEqual(
      expect.arrayContaining([
        "--volume",
        `${join(tyrumHome, "desktop-environments", "env-1", "node-home")}:/var/lib/tyrum-node`,
      ]),
    );
    expect(runArgs).toContainEqual(
      expect.arrayContaining([
        "--volume",
        `${join(tyrumHome, "desktop-environments", "env-2", "node-home")}:/var/lib/tyrum-node`,
      ]),
    );

    expect(nodePairingDal.getByNodeId).toHaveBeenNthCalledWith(1, "device-env-1", "tenant-1");
    expect(nodePairingDal.getByNodeId).toHaveBeenNthCalledWith(2, "device-env-2", "tenant-1");
    expect(nodePairingDal.resolve).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tenantId: "tenant-1",
        pairingId: 101,
        decision: "approved",
      }),
    );
    expect(nodePairingDal.resolve).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        tenantId: "tenant-1",
        pairingId: 202,
        decision: "approved",
      }),
    );
  });

  it("does not retry errored environments by issuing fresh tokens on every tick", async () => {
    inspectContainerMock.mockResolvedValue(null);

    const environmentDal = {
      listByHost: vi.fn(async () => [
        {
          tenant_id: "tenant-1",
          environment_id: "env-1",
          host_id: "host-1",
          label: "Broken",
          image_ref: "ghcr.io/tyrum/desktop:latest",
          managed_kind: "docker",
          status: "error",
          desired_running: true,
          node_id: null,
          takeover_url: null,
          last_seen_at: null,
          last_error: "image pull failed",
          created_at: "2026-03-12T00:00:00.000Z",
          updated_at: "2026-03-12T00:00:00.000Z",
        },
      ]),
      updateRuntime: vi.fn(async () => {}),
    };
    const nodePairingDal = {
      getByNodeId: vi.fn(),
      resolve: vi.fn(),
    };
    const authTokens = {
      issueToken: vi.fn(),
    };
    const logger = { error: vi.fn() };

    const runtimeManager = new DesktopEnvironmentRuntimeManager(
      environmentDal as never,
      nodePairingDal as never,
      authTokens as never,
      logger as never,
      {
        hostId: "host-1",
        tyrumHome,
        gatewayPort: 8788,
      },
    );

    await runtimeManager.reconcileAll();

    expect(authTokens.issueToken).not.toHaveBeenCalled();
    expect(runDockerMock).not.toHaveBeenCalled();
    expect(environmentDal.updateRuntime).not.toHaveBeenCalled();
    expect(nodePairingDal.getByNodeId).not.toHaveBeenCalled();
  });

  it("falls back to empty logs when failure log collection fails and continues reconciling", async () => {
    runDockerMock
      .mockResolvedValueOnce({ status: 1, stdout: "", stderr: "boom" })
      .mockResolvedValue({ status: 0, stdout: "started\n", stderr: "" });
    readContainerLogsMock.mockImplementation(async (containerName: string) => {
      if (containerName === "container-env-1") {
        throw new Error("logs unavailable");
      }
      return ["desktop runtime ready"];
    });

    const environmentDal = {
      listByHost: vi.fn(async () => [
        {
          tenant_id: "tenant-1",
          environment_id: "env-1",
          host_id: "host-1",
          label: "Broken",
          image_ref: "ghcr.io/tyrum/desktop:latest",
          managed_kind: "docker",
          status: "running",
          desired_running: true,
          node_id: null,
          takeover_url: "http://127.0.0.1:6080/vnc.html?autoconnect=true",
          last_seen_at: null,
          last_error: null,
          created_at: "2026-03-12T00:00:00.000Z",
          updated_at: "2026-03-12T00:00:00.000Z",
        },
        {
          tenant_id: "tenant-1",
          environment_id: "env-2",
          host_id: "host-1",
          label: "Healthy",
          image_ref: "ghcr.io/tyrum/desktop:latest",
          managed_kind: "docker",
          status: "starting",
          desired_running: true,
          node_id: null,
          takeover_url: null,
          last_seen_at: null,
          last_error: null,
          created_at: "2026-03-12T00:00:00.000Z",
          updated_at: "2026-03-12T00:00:00.000Z",
        },
      ]),
      updateRuntime: vi.fn(async () => {}),
    };
    const nodePairingDal = {
      getByNodeId: vi.fn(async () => ({ pairing_id: 202, status: "pending" })),
      resolve: vi.fn(async () => ({ pairing: { status: "approved" } })),
    };
    const authTokens = {
      issueToken: vi.fn(async ({ deviceId }: { deviceId: string }) => ({
        token: `token-${deviceId}`,
      })),
    };
    const logger = { error: vi.fn() };

    const runtimeManager = new DesktopEnvironmentRuntimeManager(
      environmentDal as never,
      nodePairingDal as never,
      authTokens as never,
      logger as never,
      {
        hostId: "host-1",
        tyrumHome,
        gatewayPort: 8788,
      },
    );

    await expect(runtimeManager.reconcileAll()).resolves.toBeUndefined();

    expect(environmentDal.updateRuntime).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tenantId: "tenant-1",
        environmentId: "env-1",
        status: "error",
        logs: [],
      }),
    );
    expect(environmentDal.updateRuntime).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        tenantId: "tenant-1",
        environmentId: "env-2",
        status: "running",
        logs: ["desktop runtime ready"],
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      "desktop_environment.reconcile_failure_logs_failed",
      expect.objectContaining({
        environment_id: "env-1",
        host_id: "host-1",
        error: "logs unavailable",
      }),
    );
  });

  it("captures failure logs when a starting environment still has a container", async () => {
    inspectContainerMock.mockResolvedValue({
      Config: { Image: "ghcr.io/tyrum/desktop:latest" },
      State: { Status: "exited" },
    });
    runDockerMock.mockResolvedValueOnce({ status: 1, stdout: "", stderr: "crashed" });
    readContainerLogsMock.mockResolvedValue(["container crashed"]);

    const environmentDal = {
      listByHost: vi.fn(async () => [
        {
          tenant_id: "tenant-1",
          environment_id: "env-1",
          host_id: "host-1",
          label: "Broken",
          image_ref: "ghcr.io/tyrum/desktop:latest",
          managed_kind: "docker",
          status: "starting",
          desired_running: true,
          node_id: null,
          takeover_url: null,
          last_seen_at: null,
          last_error: null,
          created_at: "2026-03-12T00:00:00.000Z",
          updated_at: "2026-03-12T00:00:00.000Z",
        },
      ]),
      updateRuntime: vi.fn(async () => {}),
    };
    const nodePairingDal = {
      getByNodeId: vi.fn(),
      resolve: vi.fn(),
    };
    const authTokens = {
      issueToken: vi.fn(),
    };
    const logger = { error: vi.fn() };

    const runtimeManager = new DesktopEnvironmentRuntimeManager(
      environmentDal as never,
      nodePairingDal as never,
      authTokens as never,
      logger as never,
      {
        hostId: "host-1",
        tyrumHome,
        gatewayPort: 8788,
      },
    );

    await expect(runtimeManager.reconcileAll()).resolves.toBeUndefined();

    expect(environmentDal.updateRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        environmentId: "env-1",
        status: "error",
        logs: ["container crashed"],
      }),
    );
  });

  it("continues reconciling later environments when persisting an error state fails", async () => {
    runDockerMock
      .mockResolvedValueOnce({ status: 1, stdout: "", stderr: "boom" })
      .mockResolvedValue({ status: 0, stdout: "started\n", stderr: "" });

    const environmentDal = {
      listByHost: vi.fn(async () => [
        {
          tenant_id: "tenant-1",
          environment_id: "env-1",
          host_id: "host-1",
          label: "Broken",
          image_ref: "ghcr.io/tyrum/desktop:latest",
          managed_kind: "docker",
          status: "starting",
          desired_running: true,
          node_id: null,
          takeover_url: null,
          last_seen_at: null,
          last_error: null,
          created_at: "2026-03-12T00:00:00.000Z",
          updated_at: "2026-03-12T00:00:00.000Z",
        },
        {
          tenant_id: "tenant-1",
          environment_id: "env-2",
          host_id: "host-1",
          label: "Healthy",
          image_ref: "ghcr.io/tyrum/desktop:latest",
          managed_kind: "docker",
          status: "starting",
          desired_running: true,
          node_id: null,
          takeover_url: null,
          last_seen_at: null,
          last_error: null,
          created_at: "2026-03-12T00:00:00.000Z",
          updated_at: "2026-03-12T00:00:00.000Z",
        },
      ]),
      updateRuntime: vi.fn(async (input: { environmentId: string; status: string }) => {
        if (input.environmentId === "env-1" && input.status === "error") {
          throw new Error("write failed");
        }
      }),
    };
    const nodePairingDal = {
      getByNodeId: vi.fn(async () => ({ pairing_id: 202, status: "pending" })),
      resolve: vi.fn(async () => ({ pairing: { status: "approved" } })),
    };
    const authTokens = {
      issueToken: vi.fn(async ({ deviceId }: { deviceId: string }) => ({
        token: `token-${deviceId}`,
      })),
    };
    const logger = { error: vi.fn() };

    const runtimeManager = new DesktopEnvironmentRuntimeManager(
      environmentDal as never,
      nodePairingDal as never,
      authTokens as never,
      logger as never,
      {
        hostId: "host-1",
        tyrumHome,
        gatewayPort: 8788,
      },
    );

    await expect(runtimeManager.reconcileAll()).resolves.toBeUndefined();

    expect(environmentDal.updateRuntime).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tenantId: "tenant-1",
        environmentId: "env-1",
        status: "error",
      }),
    );
    expect(environmentDal.updateRuntime).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        tenantId: "tenant-1",
        environmentId: "env-2",
        status: "running",
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      "desktop_environment.reconcile_failure_persist_failed",
      expect.objectContaining({
        environment_id: "env-1",
        host_id: "host-1",
        error: "write failed",
      }),
    );
  });
});
