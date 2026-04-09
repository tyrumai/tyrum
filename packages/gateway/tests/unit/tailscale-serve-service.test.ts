import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readManagedTailscaleServeState } from "../../src/modules/tailscale/serve-state.js";
import { TailscaleServeService } from "../../src/modules/tailscale/serve-service.js";

function createExecPort(options?: {
  backendState?: string;
  dnsName?: string | null;
  gatewayReachabilityReason?: string | null;
  initialServeSnapshot?: unknown;
  initialPublicBaseUrl?: string;
}) {
  let serveSnapshot = options?.initialServeSnapshot ?? {};
  let publicBaseUrl = options?.initialPublicBaseUrl ?? "http://127.0.0.1:8788";
  const backendState = options?.backendState ?? "Running";
  const dnsName = options && "dnsName" in options ? options.dnsName : "gateway.tailnet.ts.net.";
  const gatewayReachabilityReason = options?.gatewayReachabilityReason ?? null;
  const commandCounts = new Map<string, number>();

  const bumpCommandCount = (command: string): void => {
    commandCounts.set(command, (commandCounts.get(command) ?? 0) + 1);
  };

  return {
    getCommandCount(command: string) {
      return commandCounts.get(command) ?? 0;
    },
    setServeSnapshot(next: unknown) {
      serveSnapshot = next;
    },
    get publicBaseUrl() {
      return publicBaseUrl;
    },
    set publicBaseUrl(value: string) {
      publicBaseUrl = value;
    },
    async exec(file: string, args: readonly string[]) {
      expect(file).toBe("tailscale");
      const command = args.join(" ");
      bumpCommandCount(command);
      if (command === "status --json") {
        return {
          status: 0,
          stdout: JSON.stringify({
            BackendState: backendState,
            Self: dnsName ? { DNSName: dnsName } : {},
          }),
          stderr: "",
        };
      }
      if (command === "serve status --json") {
        return {
          status: 0,
          stdout: JSON.stringify(serveSnapshot),
          stderr: "",
        };
      }
      if (command === "serve --yes --bg http://127.0.0.1:8788") {
        serveSnapshot = {
          TCP: {
            "443": {
              HTTPS: true,
              Web: {
                "/": {
                  Proxy: "http://127.0.0.1:8788",
                },
              },
            },
          },
        };
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === "serve reset") {
        serveSnapshot = {};
        return { status: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected tailscale command: ${command}`);
    },
    async getPublicBaseUrl() {
      return publicBaseUrl;
    },
    async probeGatewayTarget() {
      return {
        reachable: gatewayReachabilityReason === null,
        reason: gatewayReachabilityReason,
      };
    },
    async setPublicBaseUrl(next: string) {
      publicBaseUrl = next;
    },
  };
}

describe("TailscaleServeService", () => {
  let home: string | null = null;

  afterEach(async () => {
    if (home) {
      await rm(home, { recursive: true, force: true });
      home = null;
    }
  });

  it("reports a missing tailscale binary", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-tailscale-"));
    const service = new TailscaleServeService(
      home,
      { host: "127.0.0.1", port: 8788 },
      {
        exec: async () => {
          const error = new Error("tailscale not found") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        },
        getPublicBaseUrl: async () => "http://127.0.0.1:8788",
        setPublicBaseUrl: async () => undefined,
      },
    );

    await expect(service.status()).resolves.toMatchObject({
      binaryAvailable: false,
      backendRunning: false,
      backendState: "missing",
      ownership: "disabled",
      reason: "tailscale is not installed on this machine",
    });
  });

  it("reports when the tailscale backend is not running", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-tailscale-"));
    const service = new TailscaleServeService(
      home,
      { host: "127.0.0.1", port: 8788 },
      createExecPort({ backendState: "NeedsLogin" }),
    );

    await expect(service.status()).resolves.toMatchObject({
      binaryAvailable: true,
      backendRunning: false,
      backendState: "NeedsLogin",
      reason: "tailscale backend state: NeedsLogin",
    });
  });

  it("enables tailscale serve, persists managed state, and updates publicBaseUrl", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-tailscale-"));
    const port = createExecPort();
    const service = new TailscaleServeService(home, { host: "127.0.0.1", port: 8788 }, port);

    const status = await service.enable();
    expect(status).toMatchObject({
      backendRunning: true,
      gatewayReachable: true,
      ownership: "managed",
      publicUrl: "https://gateway.tailnet.ts.net",
      currentPublicBaseUrl: "https://gateway.tailnet.ts.net",
      publicBaseUrlMatches: true,
    });

    await expect(readManagedTailscaleServeState(home)).resolves.toMatchObject({
      publicUrl: "https://gateway.tailnet.ts.net",
      previousPublicBaseUrl: "http://127.0.0.1:8788",
      dnsName: "gateway.tailnet.ts.net",
      target: { host: "127.0.0.1", port: 8788 },
    });
  });

  it("treats a second enable as idempotent when serve is already Tyrum-managed", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-tailscale-"));
    const port = createExecPort();
    const service = new TailscaleServeService(home, { host: "127.0.0.1", port: 8788 }, port);

    await service.enable();
    const second = await service.enable();

    expect(second).toMatchObject({
      ownership: "managed",
      publicBaseUrlMatches: true,
    });
    expect(port.getCommandCount("serve --yes --bg http://127.0.0.1:8788")).toBe(1);
  });

  it("rejects enable when the tailscale device has no DNS name", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-tailscale-"));
    const service = new TailscaleServeService(
      home,
      { host: "127.0.0.1", port: 8788 },
      createExecPort({ dnsName: null }),
    );

    await expect(service.enable()).rejects.toThrow("tailscale DNS name is unavailable");
  });

  it("restores the previous publicBaseUrl and clears state on disable", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-tailscale-"));
    const port = createExecPort();
    const service = new TailscaleServeService(home, { host: "127.0.0.1", port: 8788 }, port);

    await service.enable();
    const status = await service.disable();

    expect(status).toMatchObject({
      ownership: "disabled",
      currentPublicBaseUrl: "http://127.0.0.1:8788",
    });
    await expect(readManagedTailscaleServeState(home)).resolves.toBeNull();
  });

  it("refuses to disable when the managed serve config has drifted", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-tailscale-"));
    const port = createExecPort();
    const service = new TailscaleServeService(home, { host: "127.0.0.1", port: 8788 }, port);

    await service.enable();
    port.setServeSnapshot({
      TCP: {
        "443": {
          HTTPS: true,
          Web: {
            "/": {
              Proxy: "http://127.0.0.1:3000",
            },
          },
        },
      },
    });

    await expect(service.disable()).rejects.toThrow(
      "tailscale serve no longer matches Tyrum-managed state; resolve it manually before changing it here",
    );
  });

  it("refuses to overwrite an unmanaged serve configuration", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-tailscale-"));
    const port = createExecPort({
      initialServeSnapshot: {
        TCP: {
          "443": {
            HTTPS: true,
            Web: {
              "/": {
                Proxy: "http://127.0.0.1:3000",
              },
            },
          },
        },
      },
    });
    const service = new TailscaleServeService(home, { host: "127.0.0.1", port: 8788 }, port);

    await expect(service.enable()).rejects.toThrow(
      "tailscale serve is already configured on this machine and is not managed by Tyrum",
    );
  });

  it("reports when the local gateway target is unreachable", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-tailscale-"));
    const service = new TailscaleServeService(
      home,
      { host: "127.0.0.1", port: 8788 },
      createExecPort({ gatewayReachabilityReason: "connect ECONNREFUSED 127.0.0.1:8788" }),
    );

    await expect(service.status()).resolves.toMatchObject({
      gatewayReachable: false,
      gatewayReachabilityReason: "connect ECONNREFUSED 127.0.0.1:8788",
    });
  });
});
