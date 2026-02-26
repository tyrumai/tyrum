import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(APP_ROOT, "../..");

const WORKSPACE_MARKER = resolve(REPO_ROOT, "pnpm-workspace.yaml");
const DIST_INDEX = resolve(APP_ROOT, "dist/index.html");
const WORKSPACE_BUILD_LOCK = resolve(REPO_ROOT, ".tyrum-gateway-build.lock");

const isWindows = process.platform === "win32";

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function acquireBuildLock(timeoutMs = 120_000): Promise<() => void> {
  const startedAt = Date.now();
  for (;;) {
    try {
      const fd = openSync(WORKSPACE_BUILD_LOCK, "wx");
      return () => {
        try {
          closeSync(fd);
        } catch {
          // ignore
        }
        try {
          unlinkSync(WORKSPACE_BUILD_LOCK);
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
          `Timed out waiting for workspace build lock (${timeoutMs}ms): ${WORKSPACE_BUILD_LOCK}`,
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

function tryWebBuild(cmd: string, args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: isWindows,
  });
}

function buildOutputMentionsMissingFilter(output: string): boolean {
  return output.includes("No projects matched the filters");
}

async function ensureWebBuild(): Promise<void> {
  if (!existsSync(WORKSPACE_MARKER)) return;

  const release = await acquireBuildLock();
  try {
    const args = ["--filter", "@tyrum/web", "build"];
    const result = tryWebBuild("pnpm", args);
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    if (result.status !== 0) {
      if (result.error?.message.includes("ENOENT")) {
        const corepackResult = tryWebBuild("corepack", ["pnpm", ...args]);
        if (corepackResult.status === 0) return;
        throw new Error(
          formatBuildFailure(
            "Failed to build @tyrum/web via pnpm (corepack fallback).",
            corepackResult,
          ),
        );
      }

      throw new Error(formatBuildFailure("Failed to build @tyrum/web via pnpm.", result));
    }

    if (buildOutputMentionsMissingFilter(output)) {
      throw new Error(formatBuildFailure("pnpm filter did not match @tyrum/web.", result));
    }
  } finally {
    release();
  }

  if (!existsSync(DIST_INDEX)) {
    throw new Error(`Expected Vite build output missing: ${DIST_INDEX}`);
  }
}

describe("apps/web", () => {
  it("builds a static bundle for gateway /ui hosting", { timeout: 120_000 }, async () => {
    await ensureWebBuild();
    expect(existsSync(DIST_INDEX)).toBe(true);
  });
});
