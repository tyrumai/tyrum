import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testsDir, "../../..");
const distEntrypointPath = resolve(testsDir, "../dist/index.mjs");

type SafeParseSchema = {
  safeParse(input: unknown): { success: boolean };
};

async function ensureContractsDistModule(): Promise<Record<string, unknown>> {
  try {
    await access(distEntrypointPath);
  } catch {
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

  return (await import(pathToFileURL(distEntrypointPath).href)) as Record<string, unknown>;
}

function getSchema(module: Record<string, unknown>, name: string): SafeParseSchema {
  const schema = module[name];
  expect(schema).toBeDefined();
  return schema as SafeParseSchema;
}

describe("@tyrum/contracts dist entrypoint", () => {
  it("accepts the current chat and transcript shapes through the published dist bundle", async () => {
    const contractsDist = await ensureContractsDistModule();

    expect(
      getSchema(contractsDist, "WsChatSessionListRequest").safeParse({
        request_id: "req-chat.session.list",
        type: "chat.session.list",
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
      getSchema(contractsDist, "WsChatSessionSummary").safeParse({
        session_id: "session-1",
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
      getSchema(contractsDist, "TranscriptSessionSummary").safeParse({
        session_id: "session-root-1-id",
        session_key: "session-root-1",
        agent_key: "default",
        channel: "ui",
        account_key: "default",
        thread_id: "thread-root-1",
        container_kind: "channel",
        title: "Root session",
        message_count: 2,
        updated_at: "2026-03-13T12:00:00Z",
        created_at: "2026-03-13T11:00:00Z",
        archived: false,
        latest_run_id: null,
        latest_run_status: null,
        has_active_run: false,
        pending_approval_count: 0,
      }).success,
    ).toBe(true);
  });
});
