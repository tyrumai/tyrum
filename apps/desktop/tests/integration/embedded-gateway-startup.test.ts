import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayManager } from "../../src/main/gateway-manager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../../");
const GATEWAY_BIN = resolve(REPO_ROOT, "packages/gateway/dist/index.mjs");

function pnpmCommand(): string {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function ensureGatewayBuild(): void {
  const result = spawnSync(
    pnpmCommand(),
    ["--filter", "@tyrum/gateway", "build"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
    },
  );

  if (result.status === 0) return;

  throw new Error(
    [
      "Failed to build @tyrum/gateway before desktop integration test.",
      result.stdout,
      result.stderr,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address !== "object") {
        server.close(() => rejectPort(new Error("Unable to allocate free port")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          rejectPort(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function waitForHealthDown(url: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`Gateway still reachable after stop timeout (${timeoutMs}ms): ${url}`);
}

describe("desktop embedded gateway startup", () => {
  let manager: GatewayManager | undefined;
  let tempRoot: string | undefined;

  afterEach(async () => {
    if (manager) {
      await manager.stop();
      manager = undefined;
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  it(
    "starts embedded gateway via GatewayManager and passes health check",
    { timeout: 60_000 },
    async () => {
      ensureGatewayBuild();

      const port = await findAvailablePort();
      tempRoot = await mkdtemp(join(tmpdir(), "tyrum-desktop-gateway-"));
      const dbPath = join(tempRoot, "gateway.db");
      const healthUrl = `http://127.0.0.1:${port}/healthz`;

      manager = new GatewayManager();
      await manager.start({
        gatewayBin: GATEWAY_BIN,
        port,
        dbPath,
        accessToken: "desktop-integration-test-token",
        host: "127.0.0.1",
      });

      expect(manager.status).toBe("running");

      const response = await fetch(healthUrl);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { status: string };
      expect(body.status).toBe("ok");

      await manager.stop();
      expect(manager.status).toBe("stopped");
      await waitForHealthDown(healthUrl);
    },
  );
});
