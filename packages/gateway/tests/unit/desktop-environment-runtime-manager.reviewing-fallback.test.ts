import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  inspectContainerMock,
  loadOrCreateDesktopEnvironmentIdentityMock,
  readContainerLogsMock,
  readTakeoverUrlMock,
  runDockerMock,
} = vi.hoisted(() => ({
  inspectContainerMock: vi.fn(),
  loadOrCreateDesktopEnvironmentIdentityMock: vi.fn(),
  readContainerLogsMock: vi.fn(async () => []),
  readTakeoverUrlMock: vi.fn(() => "http://127.0.0.1:6080/vnc.html?autoconnect=true"),
  runDockerMock: vi.fn(async () => ({ status: 0, stdout: "started\n", stderr: "" })),
}));

vi.mock("../../src/modules/desktop-environments/device-identity.js", () => ({
  loadOrCreateDesktopEnvironmentIdentity: loadOrCreateDesktopEnvironmentIdentityMock,
}));

vi.mock("../../src/modules/desktop-environments/docker-cli.js", () => ({
  combineDockerError: vi.fn((hint: string) => hint),
  containerNameForEnvironment: vi.fn((environmentId: string) => `container-${environmentId}`),
  ensureImageAvailable: vi.fn(async () => {}),
  inspectContainer: inspectContainerMock,
  readContainerLogs: readContainerLogsMock,
  readTakeoverUrl: readTakeoverUrlMock,
  removeContainer: vi.fn(async () => {}),
  runDocker: runDockerMock,
}));

import { DesktopEnvironmentRuntimeManager } from "../../src/modules/desktop-environments/runtime-manager.js";

const TEST_IMAGE = "ghcr.io/tyrum/desktop:latest";
const TEST_TIMESTAMP = "2026-03-12T00:00:00.000Z";

describe("DesktopEnvironmentRuntimeManager approveManagedPairing fallback", () => {
  let tyrumHome: string;

  beforeEach(async () => {
    tyrumHome = await mkdtemp(join(tmpdir(), "tyrum-runtime-manager-reviewing-"));
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
    runDockerMock.mockImplementation(async () => ({ status: 0, stdout: "started\n", stderr: "" }));
  });

  afterEach(async () => {
    await rm(tyrumHome, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("approves a managed pairing that is already in reviewing status", async () => {
    const environmentDal = {
      listByHost: vi.fn(async () => [
        {
          tenant_id: "tenant-1",
          environment_id: "env-1",
          host_id: "host-1",
          label: "First",
          image_ref: TEST_IMAGE,
          managed_kind: "docker",
          status: "running",
          desired_running: true,
          node_id: null,
          takeover_url: null,
          last_seen_at: null,
          last_error: null,
          created_at: TEST_TIMESTAMP,
          updated_at: TEST_TIMESTAMP,
        },
      ]),
      updateRuntime: vi.fn(async () => {}),
    };
    const nodePairingDal = {
      getByNodeId: vi.fn(async () => ({
        pairing_id: 101,
        status: "reviewing",
      })),
      resolve: vi.fn(async () => ({ pairing: { status: "approved" } })),
    };
    const authTokens = {
      issueToken: vi.fn(async ({ deviceId }: { deviceId: string }) => ({
        token: `token-${deviceId}`,
      })),
    };
    const logger = { error: vi.fn() };

    inspectContainerMock.mockResolvedValue({
      Config: { Image: TEST_IMAGE },
      State: { Status: "running" },
    });

    const runtimeManager = new DesktopEnvironmentRuntimeManager(
      environmentDal as never,
      nodePairingDal as never,
      authTokens as never,
      logger as never,
      { hostId: "host-1", tyrumHome, gatewayPort: 8788 },
    );
    await runtimeManager.reconcileAll();

    expect(nodePairingDal.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        pairingId: 101,
        decision: "approved",
        trustLevel: "local",
        allowedCurrentStatuses: ["queued", "reviewing", "awaiting_human"],
      }),
    );
  });
});
