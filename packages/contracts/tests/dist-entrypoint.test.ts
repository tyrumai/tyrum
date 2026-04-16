import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testsDir, "../../..");
const distEntrypointPath = resolve(testsDir, "../dist/index.mjs");
const distTypesEntrypointPath = resolve(testsDir, "../dist/index.d.ts");
// Reuse the same lock that gateway dist tests hold while a packaged child process is alive.
const workspaceBuildLockPath = resolve(repoRoot, ".tyrum-gateway-build.lock");

type SafeParseSchema = {
  safeParse(input: unknown): { success: boolean };
};

type WorkspaceBuildLockContents = {
  pid?: number;
  created_at_ms?: number;
};

function buildContractsDist(): void {
  const result = spawnSync("pnpm", ["--filter", "@tyrum/contracts", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const exitCode = typeof result.status === "number" ? result.status : 1;
    throw new Error(
      `Failed to build @tyrum/contracts before loading dist/index.mjs (exit code ${String(exitCode)}).`,
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function isLivePid(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" ? (error as { code?: string }).code : undefined;
    return code !== "ESRCH";
  }
}

function readWorkspaceBuildLockContents(): WorkspaceBuildLockContents | undefined {
  try {
    const raw = readFileSync(workspaceBuildLockPath, "utf8").trim();
    if (raw.length === 0) return undefined;
    const parsed = JSON.parse(raw) as WorkspaceBuildLockContents;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function tryClearStaleWorkspaceBuildLock(timeoutMs: number): boolean {
  const metadata = readWorkspaceBuildLockContents();
  const lockAgeMs = Date.now() - statSync(workspaceBuildLockPath).mtimeMs;
  const pid = metadata?.pid;
  const isStale = (typeof pid === "number" && !isLivePid(pid)) || lockAgeMs > timeoutMs;
  if (!isStale) return false;
  try {
    unlinkSync(workspaceBuildLockPath);
    return true;
  } catch {
    return false;
  }
}

async function acquireWorkspaceBuildLock(timeoutMs = 180_000): Promise<() => void> {
  const startedAt = Date.now();

  for (;;) {
    try {
      const fd = openSync(workspaceBuildLockPath, "wx");
      writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at_ms: Date.now() }), "utf8");
      return () => {
        try {
          closeSync(fd);
        } catch {
          // ignore
        }
        try {
          unlinkSync(workspaceBuildLockPath);
        } catch {
          // ignore
        }
      };
    } catch (error) {
      const code =
        error && typeof error === "object" ? (error as { code?: string }).code : undefined;
      if (code !== "EEXIST") throw error;

      if (existsSync(workspaceBuildLockPath) && tryClearStaleWorkspaceBuildLock(timeoutMs)) {
        continue;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Timed out waiting for workspace build lock (${timeoutMs}ms): ${workspaceBuildLockPath}`,
        );
      }

      await delay(200);
    }
  }
}

async function ensureContractsDistModule(): Promise<Record<string, unknown>> {
  const release = await acquireWorkspaceBuildLock();
  try {
    try {
      await access(distEntrypointPath);
    } catch {
      buildContractsDist();
    }

    return (await import(pathToFileURL(distEntrypointPath).href)) as Record<string, unknown>;
  } finally {
    release();
  }
}

function getSchema(module: Record<string, unknown>, name: string): SafeParseSchema {
  const schema = module[name];
  expect(schema).toBeDefined();
  return schema as SafeParseSchema;
}

describe("@tyrum/contracts dist entrypoint", () => {
  it("re-exports types through the runtime entry module", async () => {
    await ensureContractsDistModule();

    await expect(readFile(distTypesEntrypointPath, "utf8")).resolves.toBe(
      'export * from "./index.mjs";\n',
    );
  }, 20_000);

  it("accepts the current chat and transcript shapes through the published dist bundle", async () => {
    const contractsDist = await ensureContractsDistModule();

    expect(
      getSchema(contractsDist, "WsConversationListRequest").safeParse({
        request_id: "req-conversation.list",
        type: "conversation.list",
        payload: {
          agent_key: "default",
          channel: "ui",
        },
      }).success,
    ).toBe(true);

    expect(
      getSchema(contractsDist, "WsTranscriptListRequest").safeParse({
        request_id: "req-transcript.list",
        type: "transcript.list",
        payload: {
          agent_key: "default",
          channel: "ui",
        },
      }).success,
    ).toBe(true);

    expect(
      getSchema(contractsDist, "WsConversationSummary").safeParse({
        conversation_id: "conversation-1",
        agent_key: "default",
        channel: "ui",
        account_key: "default",
        thread_id: "thread-1",
        container_kind: "channel",
        title: "Hello",
        message_count: 1,
        updated_at: "2026-03-13T12:00:00Z",
        created_at: "2026-03-13T12:00:00Z",
        archived: false,
      }).success,
    ).toBe(true);

    expect(
      getSchema(contractsDist, "TranscriptConversationSummary").safeParse({
        conversation_id: "conversation-root-1-id",
        conversation_key: "agent:default:main",
        agent_key: "default",
        channel: "ui",
        account_key: "default",
        thread_id: "thread-root-1",
        container_kind: "channel",
        title: "Root conversation",
        message_count: 2,
        updated_at: "2026-03-13T12:00:00Z",
        created_at: "2026-03-13T11:00:00Z",
        archived: false,
        latest_turn_id: null,
        latest_turn_status: null,
        has_active_turn: false,
        pending_approval_count: 0,
      }).success,
    ).toBe(true);

    expect(
      getSchema(contractsDist, "WorkflowRun").safeParse({
        workflow_run_id: "11111111-2222-4333-8444-555555555555",
        tenant_id: "00000000-0000-4000-8000-000000000001",
        agent_id: "00000000-0000-4000-8000-000000000002",
        workspace_id: "00000000-0000-4000-8000-000000000003",
        run_key: "agent:default:automation:default:channel:heartbeat",
        conversation_key: "agent:default:automation:default:channel:heartbeat",
        status: "queued",
        trigger: {
          kind: "heartbeat",
          metadata: {
            schedule_id: "schedule-heartbeat",
          },
        },
        plan_id: "plan-heartbeat-1",
        request_id: "req-heartbeat-1",
        input: {
          source: "scheduler",
        },
        budgets: {
          max_duration_ms: 60_000,
        },
        policy_snapshot_id: null,
        attempt: 1,
        current_step_index: null,
        created_at: "2026-04-02T10:00:00Z",
        updated_at: "2026-04-02T10:00:00Z",
        started_at: null,
        finished_at: null,
        blocked_reason: null,
        blocked_detail: null,
        budget_overridden_at: null,
        lease_owner: null,
        lease_expires_at_ms: null,
        checkpoint: null,
        last_progress_at: null,
        last_progress: null,
      }).success,
    ).toBe(true);
  }, 20_000);
});
