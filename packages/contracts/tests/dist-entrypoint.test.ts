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
