import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensureImageAvailableMock,
  inspectContainerMock,
  loadOrCreateDesktopEnvironmentIdentityMock,
  readContainerLogsMock,
  readTakeoverUrlMock,
  runDockerMock,
} = vi.hoisted(() => ({
  ensureImageAvailableMock: vi.fn(async () => {}),
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
  ensureImageAvailable: ensureImageAvailableMock,
  inspectContainer: inspectContainerMock,
  readContainerLogs: readContainerLogsMock,
  readTakeoverUrl: readTakeoverUrlMock,
  removeContainer: vi.fn(async () => {}),
  runDocker: runDockerMock,
}));

import { DesktopEnvironmentRuntimeManager } from "../../src/modules/desktop-environments/runtime-manager.js";

describe("DesktopEnvironmentRuntimeManager security hardening", () => {
  let tyrumHome: string;

  beforeEach(async () => {
    tyrumHome = await mkdtemp(join(tmpdir(), "tyrum-runtime-manager-security-"));
    loadOrCreateDesktopEnvironmentIdentityMock.mockResolvedValue({
      deviceId: "device-env-1",
      publicKey: "public-env-1",
      privateKey: "private-env-1",
    });

    let inspectCount = 0;
    inspectContainerMock.mockImplementation(async () => {
      inspectCount += 1;
      return inspectCount === 1
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

  it("bind-mounts the identity and gateway token as read-only files", async () => {
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
      ]),
      updateRuntime: vi.fn(async () => {}),
    };
    const nodePairingDal = {
      getByNodeId: vi.fn(async () => ({ pairing_id: 101, status: "queued" })),
      resolve: vi.fn(async () => ({ pairing: { status: "approved" } })),
    };
    const authTokens = {
      issueToken: vi.fn(async () => ({ token: "token-device-env-1" })),
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

    const runArgs = runDockerMock.mock.calls[0]?.[0] as string[] | undefined;
    expect(runArgs).toBeDefined();
    expect(runArgs).toEqual(
      expect.arrayContaining([
        "--volume",
        `${join(tyrumHome, "desktop-environments", "env-1", "runtime-home")}:/var/lib/tyrum-node`,
        "--volume",
        `${join(
          tyrumHome,
          "desktop-environments",
          "env-1",
          "identity",
          "desktop-node",
          "device-identity.json",
        )}:/var/lib/tyrum-node/desktop-node/device-identity.json:ro`,
        "--volume",
        `${join(tyrumHome, "desktop-environments", "env-1", "secrets", "gateway-token")}:/run/tyrum/gateway-token:ro`,
        "--env",
        "TYRUM_GATEWAY_TOKEN_PATH=/run/tyrum/gateway-token",
      ]),
    );
    expect(runArgs?.some((arg) => arg.startsWith("TYRUM_GATEWAY_TOKEN="))).toBe(false);

    const tokenPath = join(tyrumHome, "desktop-environments", "env-1", "secrets", "gateway-token");
    await expect(readFile(tokenPath, "utf8")).resolves.toBe("token-device-env-1\n");
    expect((await stat(tokenPath)).mode & 0o777).toBe(0o600);
  });
});
