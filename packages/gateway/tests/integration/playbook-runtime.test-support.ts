import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { createApp } from "../../src/app.js";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { ExecutionEngine, type StepExecutor } from "../../src/modules/execution/engine.js";
import { loadAllPlaybooks } from "../../src/modules/playbook/loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");
const fixturesDir = join(__dirname, "../fixtures/playbooks");

export const runtimeJsonHeaders = { "content-type": "application/json" };

function forceManualOnlyApprovalReview(container: GatewayContainer): void {
  const original = container.policyService.loadEffectiveBundle.bind(container.policyService);
  vi.spyOn(container.policyService, "loadEffectiveBundle").mockImplementation(async (params) => {
    const effective = await original(params);
    return {
      ...effective,
      bundle: {
        ...effective.bundle,
        approvals: {
          auto_review: {
            mode: "manual_only" as const,
          },
        },
      },
    };
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForWorkflowRunId(
  container: GatewayContainer,
  timeoutMs = 1_000,
): Promise<string> {
  const deadline = Date.now() + Math.max(1, timeoutMs);
  while (Date.now() < deadline) {
    const row = await container.db.get<{ workflow_run_id: string }>(
      `SELECT workflow_run_id
       FROM workflow_runs
       ORDER BY created_at DESC
       LIMIT 1`,
    );
    if (row?.workflow_run_id) return row.workflow_run_id;
    await sleep(5);
  }
  throw new Error("timed out waiting for workflow run to be created");
}

export async function waitForRunStatus(
  container: GatewayContainer,
  turnId: string,
  statuses: readonly string[],
  timeoutMs = 1_000,
): Promise<string> {
  const desired = new Set(statuses);
  const deadline = Date.now() + Math.max(1, timeoutMs);
  while (Date.now() < deadline) {
    const row = await container.db.get<{ status: string }>(
      "SELECT status FROM turns WHERE turn_id = ?",
      [turnId],
    );
    if (row?.status && desired.has(row.status)) return row.status;
    await sleep(5);
  }
  throw new Error(`timed out waiting for run status: ${statuses.join(", ")}`);
}

export async function createRuntimeContext(homeDir: string) {
  const container = await createContainer({
    dbPath: ":memory:",
    migrationsDir,
    tyrumHome: homeDir,
  });
  forceManualOnlyApprovalReview(container);
  const engine = new ExecutionEngine({
    db: container.db,
    redactionEngine: container.redactionEngine,
    policyService: container.policyService,
    logger: container.logger,
  });
  const playbooks = loadAllPlaybooks(fixturesDir, { onInvalidPlaybook: () => {} });
  const app = createApp(container, { engine, playbooks });
  return { container, engine, app };
}

export async function startPausedRunForApproval(opts: {
  app: ReturnType<typeof createApp>;
  container: GatewayContainer;
  engine: ExecutionEngine;
  body: Record<string, unknown>;
}) {
  const { app, container, engine } = opts;
  const runResPromise = app.request("/playbooks/runtime", {
    method: "POST",
    headers: runtimeJsonHeaders,
    body: JSON.stringify(opts.body),
  });

  const turnId = await waitForWorkflowRunId(container);
  const pauseExecutor: StepExecutor = {
    execute: vi.fn(async () => {
      throw new Error("step execution should not run before policy approval");
    }),
  };
  await engine.workerTick({ workerId: "w1", executor: pauseExecutor, turnId });

  const runRes = await runResPromise;
  const paused = (await runRes.json()) as { requiresApproval?: { resumeToken?: string } };
  const resumeToken = paused.requiresApproval?.resumeToken ?? "";
  if (!resumeToken) {
    throw new Error("timed out waiting for playbook runtime approval token");
  }

  return { turnId, resumeToken };
}
