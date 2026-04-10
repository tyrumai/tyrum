import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  combineDockerErrorMock,
  containerNameForEnvironmentMock,
  ensureImageAvailableMock,
  inspectContainerMock,
  loadOrCreateDesktopEnvironmentIdentityMock,
  readContainerLogsMock,
  readTakeoverUrlMock,
  removeContainerMock,
  runDockerMock,
} = vi.hoisted(() => ({
  combineDockerErrorMock: vi.fn((hint: string) => hint),
  containerNameForEnvironmentMock: vi.fn((environmentId: string) => `container-${environmentId}`),
  ensureImageAvailableMock: vi.fn(async () => {}),
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
  ensureImageAvailable: ensureImageAvailableMock,
  inspectContainer: inspectContainerMock,
  readContainerLogs: readContainerLogsMock,
  readTakeoverUrl: readTakeoverUrlMock,
  removeContainer: removeContainerMock,
  runDocker: runDockerMock,
}));

import { DesktopEnvironmentRuntimeManager } from "../../src/modules/desktop-environments/runtime-manager.js";

const OFFICIAL_SANDBOX_IMAGE = "ghcr.io/tyrumai/tyrum-desktop-sandbox:main";
const TEST_IMAGE = "ghcr.io/tyrum/desktop:latest";
const TEST_TIMESTAMP = "2026-03-12T00:00:00.000Z";

function createEnvironment(
  overrides: Partial<Record<string, unknown>> & {
    environment_id: string;
    label: string;
    status: string;
  },
) {
  return {
    tenant_id: "tenant-1",
    host_id: "host-1",
    image_ref: TEST_IMAGE,
    managed_kind: "docker",
    desired_running: true,
    node_id: null,
    takeover_url: null,
    last_seen_at: null,
    last_error: null,
    created_at: TEST_TIMESTAMP,
    updated_at: TEST_TIMESTAMP,
    ...overrides,
  };
}

describe("DesktopEnvironmentRuntimeManager platform selection", () => {
  let tyrumHome: string;

  beforeEach(async () => {
    tyrumHome = await mkdtemp(join(tmpdir(), "tyrum-runtime-manager-platform-"));
    combineDockerErrorMock.mockImplementation((hint: string) => hint);
    containerNameForEnvironmentMock.mockImplementation(
      (environmentId: string) => `container-${environmentId}`,
    );
    ensureImageAvailableMock.mockImplementation(async () => {});
    loadOrCreateDesktopEnvironmentIdentityMock.mockImplementation(async (identityPath: string) => {
      const match =
        /desktop-environments\/([^/]+)\/identity\/desktop-node\/device-identity\.json$/u.exec(
          identityPath,
        );
      const environmentId = match?.[1] ?? "unknown";
      return {
        deviceId: `device-${environmentId}`,
        publicKey: `public-${environmentId}`,
        privateKey: `private-${environmentId}`,
      };
    });
    readContainerLogsMock.mockImplementation(async () => []);
    readTakeoverUrlMock.mockImplementation(() => "http://127.0.0.1:6080/vnc.html?autoconnect=true");
    removeContainerMock.mockImplementation(async () => {});
    runDockerMock.mockImplementation(async () => ({ status: 0, stdout: "started\n", stderr: "" }));
    const inspectCounts = new Map<string, number>();
    inspectContainerMock.mockImplementation(async (containerName: string) => {
      const count = inspectCounts.get(containerName) ?? 0;
      inspectCounts.set(containerName, count + 1);
      return count === 0
        ? null
        : {
            Config: { Image: TEST_IMAGE },
            State: { Status: "running" },
          };
    });
  });

  afterEach(async () => {
    await rm(tyrumHome, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function createRuntimeManager(options: {
    hostPlatform?: NodeJS.Platform;
    hostArch?: string;
    publicBaseUrl?: string;
    selinuxEnforcing?: boolean;
  }) {
    const environmentDal = {
      listByHost: vi.fn(async () => []),
      updateRuntime: vi.fn(async () => {}),
    };
    const nodePairingDal = {
      getByNodeId: vi.fn(async () => ({ pairing_id: 101, status: "queued" })),
      resolve: vi.fn(async () => ({ pairing: { status: "approved" } })),
    };
    const authTokens = {
      issueToken: vi.fn(async ({ deviceId }: { deviceId: string }) => ({
        token: `token-${deviceId}`,
      })),
    };
    const logger = { error: vi.fn() };

    return {
      environmentDal,
      logger,
      runtimeManager: new DesktopEnvironmentRuntimeManager(
        environmentDal as never,
        nodePairingDal as never,
        authTokens as never,
        logger as never,
        {
          hostId: "host-1",
          tyrumHome,
          gatewayPort: 8788,
          hostPlatform: options.hostPlatform,
          hostArch: options.hostArch,
          publicBaseUrl: options.publicBaseUrl,
          selinuxEnforcing: options.selinuxEnforcing,
        },
      ),
    };
  }

  function findDockerArgs(command: string): string[] | undefined {
    return runDockerMock.mock.calls.find((call) => call[0]?.[0] === command)?.[0] as
      | string[]
      | undefined;
  }

  it("pins the official sandbox image to linux/amd64 on arm64 macOS", async () => {
    const { environmentDal, runtimeManager } = createRuntimeManager({
      hostPlatform: "darwin",
      hostArch: "arm64",
    });
    environmentDal.listByHost.mockResolvedValue([
      createEnvironment({
        environment_id: "env-1",
        label: "Sandbox",
        status: "starting",
        image_ref: OFFICIAL_SANDBOX_IMAGE,
      }),
    ]);

    await runtimeManager.reconcileAll();

    expect(ensureImageAvailableMock).toHaveBeenCalledWith(OFFICIAL_SANDBOX_IMAGE, {
      platform: "linux/amd64",
    });
    expect(findDockerArgs("run")).toEqual(
      expect.arrayContaining(["run", "--platform", "linux/amd64", OFFICIAL_SANDBOX_IMAGE]),
    );
  });

  it("does not pin custom images on arm64 macOS", async () => {
    const { environmentDal, runtimeManager } = createRuntimeManager({
      hostPlatform: "darwin",
      hostArch: "arm64",
    });
    environmentDal.listByHost.mockResolvedValue([
      createEnvironment({ environment_id: "env-1", label: "Custom", status: "starting" }),
    ]);

    await runtimeManager.reconcileAll();

    expect(ensureImageAvailableMock).toHaveBeenCalledWith(TEST_IMAGE);
    expect(findDockerArgs("run")).not.toContain("--platform");
  });

  it("does not pin the official sandbox image on non-arm64 hosts", async () => {
    const { environmentDal, runtimeManager } = createRuntimeManager({
      hostPlatform: "linux",
      hostArch: "x64",
    });
    environmentDal.listByHost.mockResolvedValue([
      createEnvironment({
        environment_id: "env-1",
        label: "Sandbox",
        status: "starting",
        image_ref: OFFICIAL_SANDBOX_IMAGE,
      }),
    ]);

    await runtimeManager.reconcileAll();

    expect(ensureImageAvailableMock).toHaveBeenCalledWith(OFFICIAL_SANDBOX_IMAGE);
    expect(findDockerArgs("run")).not.toContain("--platform");
  });

  it("uses SELinux-aware bind mounts on Linux hosts when SELinux is enforcing", async () => {
    const environmentId = "env-1";
    const { environmentDal, runtimeManager } = createRuntimeManager({
      hostPlatform: "linux",
      hostArch: "x64",
      selinuxEnforcing: true,
    });
    environmentDal.listByHost.mockResolvedValue([
      createEnvironment({
        environment_id: environmentId,
        label: "Sandbox",
        status: "starting",
      }),
    ]);

    await runtimeManager.reconcileAll();

    expect(findDockerArgs("run")).toEqual(
      expect.arrayContaining([
        "--volume",
        `${join(tyrumHome, "desktop-environments", environmentId, "runtime-home")}:/var/lib/tyrum-node:Z`,
        "--volume",
        `${join(tyrumHome, "desktop-environments", environmentId, "identity", "desktop-node", "device-identity.json")}:/var/lib/tyrum-node/desktop-node/device-identity.json:ro,Z`,
        "--volume",
        `${join(tyrumHome, "desktop-environments", environmentId, "secrets", "gateway-token")}:/run/tyrum/gateway-token:ro,Z`,
      ]),
    );
  });

  it("prefers the public base URL for desktop-node websocket access when it is non-loopback", async () => {
    const { environmentDal, runtimeManager } = createRuntimeManager({
      hostPlatform: "linux",
      hostArch: "x64",
      publicBaseUrl: "https://desktop-ron.tail5b753a.ts.net",
    });
    environmentDal.listByHost.mockResolvedValue([
      createEnvironment({
        environment_id: "env-1",
        label: "Sandbox",
        status: "starting",
      }),
    ]);

    await runtimeManager.reconcileAll();

    expect(findDockerArgs("run")).toEqual(
      expect.arrayContaining([
        "--env",
        "TYRUM_GATEWAY_WS_URL=wss://desktop-ron.tail5b753a.ts.net/ws",
      ]),
    );
  });

  it("recreates stopped official sandbox containers on arm64 macOS instead of starting them", async () => {
    inspectContainerMock
      .mockResolvedValueOnce({
        Config: { Image: OFFICIAL_SANDBOX_IMAGE },
        State: { Status: "exited" },
      })
      .mockResolvedValueOnce({
        Config: { Image: OFFICIAL_SANDBOX_IMAGE },
        State: { Status: "running" },
      });

    const { environmentDal, runtimeManager } = createRuntimeManager({
      hostPlatform: "darwin",
      hostArch: "arm64",
    });
    environmentDal.listByHost.mockResolvedValue([
      createEnvironment({
        environment_id: "env-1",
        label: "Sandbox",
        status: "starting",
        image_ref: OFFICIAL_SANDBOX_IMAGE,
      }),
    ]);

    await runtimeManager.reconcileAll();

    expect(removeContainerMock).toHaveBeenCalledWith("container-env-1");
    expect(findDockerArgs("start")).toBeUndefined();
    expect(findDockerArgs("run")).toEqual(
      expect.arrayContaining(["run", "--platform", "linux/amd64", OFFICIAL_SANDBOX_IMAGE]),
    );
  });

  it("does not recreate errored stopped official sandbox containers on arm64 macOS", async () => {
    inspectContainerMock.mockResolvedValue({
      Config: { Image: OFFICIAL_SANDBOX_IMAGE },
      State: { Status: "exited" },
    });

    const { environmentDal, runtimeManager } = createRuntimeManager({
      hostPlatform: "darwin",
      hostArch: "arm64",
    });
    environmentDal.listByHost.mockResolvedValue([
      createEnvironment({
        environment_id: "env-1",
        label: "Sandbox",
        status: "error",
        image_ref: OFFICIAL_SANDBOX_IMAGE,
        last_error: "container crashed",
      }),
    ]);

    await runtimeManager.reconcileAll();

    expect(removeContainerMock).not.toHaveBeenCalled();
    expect(ensureImageAvailableMock).not.toHaveBeenCalled();
    expect(findDockerArgs("run")).toBeUndefined();
    expect(findDockerArgs("start")).toBeUndefined();
    expect(environmentDal.updateRuntime).not.toHaveBeenCalled();
  });
});
