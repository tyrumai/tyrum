import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");

const DIST_ENTRYPOINT = resolve(PACKAGE_ROOT, "dist/index.mjs");
const SRC_ROOT = resolve(PACKAGE_ROOT, "src");
const SCHEMAS_DIST_ENTRYPOINT = resolve(REPO_ROOT, "packages/contracts/dist/index.mjs");
const SCHEMAS_JSONSCHEMA_CATALOG = resolve(
  REPO_ROOT,
  "packages/contracts/dist/jsonschema/catalog.json",
);
const GATEWAY_BUILD_LOCK = resolve(REPO_ROOT, ".tyrum-gateway-build.lock");

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn(),
    readyState: 1, // OPEN
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

const isWindows = process.platform === "win32";

function maxMtimeMsInDir(dir: string): number {
  let max = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      max = Math.max(max, maxMtimeMsInDir(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts")) continue;
    max = Math.max(max, statSync(fullPath).mtimeMs);
  }
  return max;
}

function gatewayBuildIsStale(): boolean {
  if (!existsSync(DIST_ENTRYPOINT)) return true;
  if (!existsSync(SCHEMAS_DIST_ENTRYPOINT)) return true;
  if (!existsSync(SCHEMAS_JSONSCHEMA_CATALOG)) return true;

  const distMtime = statSync(DIST_ENTRYPOINT).mtimeMs;

  if (existsSync(SRC_ROOT)) {
    const srcMtime = maxMtimeMsInDir(SRC_ROOT);
    if (distMtime < srcMtime) return true;
  }

  const schemasMtime = statSync(SCHEMAS_DIST_ENTRYPOINT).mtimeMs;
  if (distMtime < schemasMtime) return true;

  return false;
}

async function acquireGatewayBuildLock(timeoutMs = 180_000): Promise<() => void> {
  const startedAt = Date.now();
  for (;;) {
    try {
      const fd = openSync(GATEWAY_BUILD_LOCK, "wx");
      return () => {
        try {
          closeSync(fd);
        } catch {
          // ignore
        }
        try {
          unlinkSync(GATEWAY_BUILD_LOCK);
        } catch {
          // ignore
        }
      };
    } catch (err) {
      const code = err && typeof err === "object" ? (err as { code?: string }).code : undefined;
      if (code !== "EEXIST") {
        throw err;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Timed out waiting for gateway build lock (${timeoutMs}ms): ${GATEWAY_BUILD_LOCK}`,
        );
      }

      await delay(200);
    }
  }
}

function formatBuildFailure(prefix: string, result: ReturnType<typeof spawnSync>): string {
  const details = [
    prefix,
    result.error ? `spawn error: ${result.error.message}` : undefined,
    result.status === null ? "exit status: null" : `exit status: ${String(result.status)}`,
    result.stdout,
    result.stderr,
  ].filter(Boolean);
  return details.join("\n");
}

function tryGatewayBuild(cmd: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: isWindows,
  });
}

async function buildGatewayDistIfStale(): Promise<void> {
  if (!gatewayBuildIsStale()) return;

  const commands = [
    ...(!existsSync(SCHEMAS_DIST_ENTRYPOINT) || !existsSync(SCHEMAS_JSONSCHEMA_CATALOG)
      ? ([["--filter", "@tyrum/contracts", "build"]] as const)
      : ([] as const)),
    ["--filter", "@tyrum/gateway", "build"],
  ] as const;

  for (const args of commands) {
    const result = tryGatewayBuild("pnpm", args);
    if (result.status === 0) continue;

    if (result.error?.message.includes("ENOENT")) {
      const corepackResult = tryGatewayBuild("corepack", ["pnpm", ...args]);
      if (corepackResult.status === 0) continue;
      throw new Error(
        formatBuildFailure(
          "Failed to build gateway dist before dist-heartbeat test via corepack.",
          corepackResult,
        ),
      );
    }

    throw new Error(
      formatBuildFailure("Failed to build gateway dist before dist-heartbeat test.", result),
    );
  }

  if (!existsSync(DIST_ENTRYPOINT)) {
    throw new Error(`Gateway dist entrypoint not found after build: ${DIST_ENTRYPOINT}`);
  }
}

async function withGatewayBuild<T>(action: () => Promise<T>): Promise<T> {
  const release = await acquireGatewayBuildLock();
  try {
    await buildGatewayDistIfStale();
    return await action();
  } finally {
    release();
  }
}

describe("gateway dist bundle", () => {
  it(
    "uses WS ping/pong control frames for heartbeats (regression for /app/live disconnects)",
    { timeout: 180_000 },
    async () => {
      await withGatewayBuild(async () => {
        const mod = await import(pathToFileURL(DIST_ENTRYPOINT).href);
        const ConnectionManager = mod.ConnectionManager as {
          new (): {
            addClient: (ws: unknown, capabilities: unknown[]) => string;
            heartbeat: () => void;
          };
        };

        const cm = new ConnectionManager();
        const ws = createMockWs();
        cm.addClient(ws as never, []);

        cm.heartbeat();

        expect(ws.ping).toHaveBeenCalledOnce();
        expect(ws.send).not.toHaveBeenCalled();
      });
    },
  );
});
