import { spawnSync } from "node:child_process";
import type { McpManager } from "../../src/modules/agent/mcp-manager.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { runZenityA11ySmoke as runZenityA11ySmokeImpl } from "./desktop-sandbox-e2e-a11y.js";

type SqlRunner = {
  run(sql: string, params?: unknown[]): Promise<unknown>;
};

export type ExecutionScopeIds = {
  jobId: string;
  runId: string;
  stepId: string;
  attemptId: string;
};

type DockerResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  signal?: NodeJS.Signals | null;
};

type DesktopDispatchService = {
  dispatchAndWait(
    request: { type: "Desktop"; args: Record<string, unknown> },
    context: {
      tenantId: string;
      runId: string;
      stepId: string;
      attemptId: string;
    },
    options: { timeoutMs: number },
  ): Promise<{
    result: {
      ok: boolean;
      result?: unknown;
      error?: string;
    };
  }>;
};

const DOCKER_INFO_TIMEOUT_MS = 15_000;
const DOCKER_IMAGE_INSPECT_TIMEOUT_MS = 15_000;
const DOCKER_BUILD_TIMEOUT_MS = 10 * 60_000;
const DOCKER_RUN_TIMEOUT_MS = 60_000;
const DOCKER_LOGS_TIMEOUT_MS = 30_000;
const DOCKER_EXEC_TIMEOUT_MS = 10_000;
const DOCKER_CLEANUP_TIMEOUT_MS = 30_000;
const DOCKER_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export async function seedExecutionScope(db: SqlRunner, ids: ExecutionScopeIds): Promise<void> {
  await db.run(
    `INSERT INTO execution_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       key,
       lane,
       status,
       trigger_json,
       input_json,
       latest_run_id
     )
     VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      ids.jobId,
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      "agent:agent-1:thread:thread-1",
      "main",
      "{}",
      "{}",
      ids.runId,
    ],
  );

  await db.run(
    `INSERT INTO execution_runs (tenant_id, run_id, job_id, key, lane, status, attempt)
     VALUES (?, ?, ?, ?, ?, 'running', 1)`,
    [DEFAULT_TENANT_ID, ids.runId, ids.jobId, "agent:agent-1:thread:thread-1", "main"],
  );

  await db.run(
    `INSERT INTO execution_steps (tenant_id, step_id, run_id, step_index, status, action_json)
     VALUES (?, ?, ?, 0, 'running', ?)`,
    [DEFAULT_TENANT_ID, ids.stepId, ids.runId, "{}"],
  );

  await db.run(
    `INSERT INTO execution_attempts (tenant_id, attempt_id, step_id, attempt, status, artifacts_json)
     VALUES (?, ?, ?, 1, 'running', '[]')`,
    [DEFAULT_TENANT_ID, ids.attemptId, ids.stepId],
  );
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function runDocker(
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; maxBufferBytes?: number },
): DockerResult {
  const result = spawnSync("docker", args, {
    cwd: opts?.cwd,
    env: opts?.env,
    encoding: "utf8",
    timeout: opts?.timeoutMs,
    maxBuffer: opts?.maxBufferBytes ?? DOCKER_MAX_BUFFER_BYTES,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message,
    signal: result.signal,
  };
}

export function dockerAvailable(): boolean {
  return runDocker(["info"], { timeoutMs: DOCKER_INFO_TIMEOUT_MS }).status === 0;
}

function dockerImageExists(tag: string): boolean {
  return (
    runDocker(["image", "inspect", tag], { timeoutMs: DOCKER_IMAGE_INSPECT_TIMEOUT_MS }).status ===
    0
  );
}

function assertDockerOk(result: DockerResult, hint: string): void {
  if (result.status === 0) return;
  const signal = result.signal ? `signal=${result.signal}` : undefined;
  throw new Error(
    [hint, result.error, signal, result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n...(truncated)";
}

export function stubMcpManager(): McpManager {
  return {
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({ content: [] }),
  } as unknown as McpManager;
}

export async function waitForPendingDesktopPairing(params: {
  listPending: () => Promise<Array<{ pairing_id: number; node: { capabilities: string[] } }>>;
  timeoutMs?: number;
}): Promise<{ pairing_id: number }> {
  const deadlineMs = Date.now() + Math.max(1, Math.floor(params.timeoutMs ?? 60_000));
  while (Date.now() < deadlineMs) {
    const pairings = await params.listPending();
    const pairing = pairings.find(
      (pending) =>
        Array.isArray(pending.node.capabilities) && pending.node.capabilities.includes("desktop"),
    );
    if (pairing) return pairing;
    await delay(250);
  }
  throw new Error("timed out waiting for pending desktop pairing");
}

export async function waitForNoVncReady(containerName: string, timeoutMs: number): Promise<void> {
  const deadlineMs = Date.now() + Math.max(1, Math.floor(timeoutMs));
  while (Date.now() < deadlineMs) {
    const result = runDocker(
      [
        "exec",
        containerName,
        "bash",
        "-lc",
        'curl -fsS "http://127.0.0.1:6080/vnc.html" >/dev/null',
      ],
      { timeoutMs: DOCKER_EXEC_TIMEOUT_MS },
    );
    if (result.status === 0) return;
    await delay(500);
  }

  const logResult = runDocker(
    ["exec", containerName, "bash", "-lc", "tail -n 50 /tmp/novnc.log 2>/dev/null || true"],
    { timeoutMs: DOCKER_EXEC_TIMEOUT_MS },
  );
  throw new Error(
    [
      "noVNC did not become ready inside desktop-sandbox container.",
      truncate(logResult.stdout + logResult.stderr, 4_000),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export function resolveDesktopSandboxImageTag(): string {
  return process.env["TYRUM_DESKTOP_SANDBOX_IMAGE"]?.trim() || "tyrum-desktop-sandbox-e2e:local";
}

export function ensureDesktopSandboxImage(imageTag: string, repoRoot: string): void {
  const shouldBuild =
    process.env["CI"] === "true" ||
    process.env["TYRUM_DESKTOP_SANDBOX_REBUILD"] === "1" ||
    !dockerImageExists(imageTag);
  if (!shouldBuild) return;

  const build = runDocker(
    ["build", "-f", "docker/desktop-sandbox/Dockerfile", "-t", imageTag, "."],
    {
      cwd: repoRoot,
      timeoutMs: DOCKER_BUILD_TIMEOUT_MS,
    },
  );
  assertDockerOk(build, "Failed to build desktop-sandbox image for e2e test.");
}

export function startDesktopSandboxContainer(params: {
  adminToken: string;
  containerName: string;
  gatewayPort: number;
  imageTag: string;
}): string {
  const runArgsBase = [
    "run",
    "--detach",
    "--name",
    params.containerName,
    "-e",
    `TYRUM_GATEWAY_TOKEN=${params.adminToken}`,
    "-e",
    "TYRUM_NODE_LABEL=tyrum-desktop-sandbox-e2e",
    "-e",
    "TYRUM_NODE_MODE=desktop-sandbox",
  ];
  const wsUrlViaHostGateway = `ws://host.containers.internal:${params.gatewayPort}/ws`;
  const wsUrlViaHostNetwork = `ws://127.0.0.1:${params.gatewayPort}/ws`;

  let run = runDocker(
    [
      ...runArgsBase,
      "-e",
      `TYRUM_GATEWAY_WS_URL=${wsUrlViaHostGateway}`,
      "--add-host",
      "host.containers.internal:host-gateway",
      params.imageTag,
    ],
    { timeoutMs: DOCKER_RUN_TIMEOUT_MS },
  );
  if (run.status !== 0) {
    const combined = (run.stdout + run.stderr).toLowerCase();
    if (combined.includes("host-gateway")) {
      const fallback = runDocker(
        [
          ...runArgsBase,
          "--network",
          "host",
          "-e",
          `TYRUM_GATEWAY_WS_URL=${wsUrlViaHostNetwork}`,
          params.imageTag,
        ],
        { timeoutMs: DOCKER_RUN_TIMEOUT_MS },
      );
      if (fallback.status === 0) {
        run = fallback;
      } else {
        assertDockerOk(
          fallback,
          "Failed to start desktop-sandbox container (fallback to --network host).",
        );
      }
    } else {
      assertDockerOk(run, "Failed to start desktop-sandbox container.");
    }
  }

  const containerId = run.stdout.trim();
  if (!containerId) {
    throw new Error(`desktop-sandbox container did not return an id: ${run.stdout}`);
  }
  return containerId;
}

export function readDockerLogs(containerName: string, maxChars = 16_000): string {
  const logs = runDocker(["logs", containerName], { timeoutMs: DOCKER_LOGS_TIMEOUT_MS });
  return truncate(logs.stdout + logs.stderr, maxChars);
}

export function cleanupDockerContainer(params: {
  containerName?: string;
  containerId?: string;
}): void {
  if (params.containerName) {
    runDocker(["stop", params.containerName], { timeoutMs: DOCKER_CLEANUP_TIMEOUT_MS });
    runDocker(["rm", "-f", params.containerName], { timeoutMs: DOCKER_CLEANUP_TIMEOUT_MS });
    return;
  }
  if (!params.containerId) return;

  runDocker(["stop", params.containerId], { timeoutMs: DOCKER_CLEANUP_TIMEOUT_MS });
  runDocker(["rm", "-f", params.containerId], { timeoutMs: DOCKER_CLEANUP_TIMEOUT_MS });
}
export async function runZenityA11ySmoke(params: {
  containerName: string;
  nodeDispatchService: DesktopDispatchService;
  scope: ExecutionScopeIds;
}): Promise<void> {
  await runZenityA11ySmokeImpl({
    ...params,
    dockerExec(containerName, command, timeoutMs = DOCKER_EXEC_TIMEOUT_MS) {
      return runDocker(["exec", containerName, "bash", "-lc", command], { timeoutMs });
    },
    truncate,
  });
}
