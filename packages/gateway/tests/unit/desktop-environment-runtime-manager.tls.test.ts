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

describe("DesktopEnvironmentRuntimeManager TLS", () => {
  let tyrumHome: string;

  beforeEach(async () => {
    tyrumHome = await mkdtemp(join(tmpdir(), "tyrum-runtime-manager-tls-"));
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

  function createRuntimeManager(options: { gatewayWsUrl?: string }) {
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
      runtimeManager: new DesktopEnvironmentRuntimeManager(
        environmentDal as never,
        nodePairingDal as never,
        authTokens as never,
        logger as never,
        {
          hostId: "host-1",
          tyrumHome,
          gatewayPort: 8788,
          ...options,
        },
      ),
    };
  }

  function findDockerArgs(command: string): string[] | undefined {
    return runDockerMock.mock.calls.find((call) => call[0]?.[0] === command)?.[0] as
      | string[]
      | undefined;
  }

  it("uses the local ws:// gateway target for managed desktop sandboxes", async () => {
    const { environmentDal, runtimeManager } = createRuntimeManager({});
    environmentDal.listByHost.mockResolvedValue([
      createEnvironment({ environment_id: "env-tls", label: "TLS Sandbox", status: "starting" }),
    ]);

    await runtimeManager.reconcileAll();

    const runArgs = findDockerArgs("run");
    expect(runArgs).toBeDefined();
    expect(runArgs).toEqual(
      expect.arrayContaining([
        "--env",
        "TYRUM_GATEWAY_WS_URL=ws://host.containers.internal:8788/ws",
      ]),
    );
    const joined = runArgs!.join(" ");
    expect(joined).not.toContain("TYRUM_GATEWAY_TLS_FINGERPRINT256");
    expect(joined).not.toContain("TYRUM_GATEWAY_TLS_ALLOW_SELF_SIGNED");
  });

  it("does not inject TLS env vars by default", async () => {
    const { environmentDal, runtimeManager } = createRuntimeManager({});
    environmentDal.listByHost.mockResolvedValue([
      createEnvironment({
        environment_id: "env-plain",
        label: "Plain Sandbox",
        status: "starting",
      }),
    ]);

    await runtimeManager.reconcileAll();

    const runArgs = findDockerArgs("run");
    expect(runArgs).toBeDefined();
    expect(runArgs).toEqual(
      expect.arrayContaining([
        "--env",
        "TYRUM_GATEWAY_WS_URL=ws://host.containers.internal:8788/ws",
      ]),
    );
    const joined = runArgs!.join(" ");
    expect(joined).not.toContain("TYRUM_GATEWAY_TLS_FINGERPRINT256");
    expect(joined).not.toContain("TYRUM_GATEWAY_TLS_ALLOW_SELF_SIGNED");
  });

  it("explicit gatewayWsUrl override takes precedence over the default target", async () => {
    const { environmentDal, runtimeManager } = createRuntimeManager({
      gatewayWsUrl: "ws://custom:9999/ws",
    });
    environmentDal.listByHost.mockResolvedValue([
      createEnvironment({
        environment_id: "env-override",
        label: "Override Sandbox",
        status: "starting",
      }),
    ]);

    await runtimeManager.reconcileAll();

    const runArgs = findDockerArgs("run");
    expect(runArgs).toBeDefined();
    expect(runArgs).toEqual(
      expect.arrayContaining(["--env", "TYRUM_GATEWAY_WS_URL=ws://custom:9999/ws"]),
    );
    const joined = runArgs!.join(" ");
    expect(joined).not.toContain("TYRUM_GATEWAY_TLS_FINGERPRINT256");
    expect(joined).not.toContain("TYRUM_GATEWAY_TLS_ALLOW_SELF_SIGNED");
  });
});
