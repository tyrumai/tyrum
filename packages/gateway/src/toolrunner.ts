import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/contracts";
import { ActionPrimitive } from "@tyrum/contracts";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDbSecretProvider } from "./modules/secret/create-secret-provider.js";
import { createLocalStepExecutor } from "./modules/execution/local-step-executor.js";
import type { StepExecutionContext } from "./modules/execution/engine.js";
import { requireTenantIdValue } from "./modules/identity/scope.js";
import { RedactionEngine } from "./modules/redaction/engine.js";
import { createArtifactStore } from "./modules/artifact/create-artifact-store.js";
import { Logger } from "./modules/observability/logger.js";
import { PolicyService } from "./modules/policy/service.js";
import { PolicyOverrideDal } from "./modules/policy/override-dal.js";
import { PolicySnapshotDal } from "./modules/policy/snapshot-dal.js";
import { SqliteDb } from "./statestore/sqlite.js";
import { PostgresDb } from "./statestore/postgres.js";
import { isPostgresDbUri } from "./statestore/db-uri.js";
import { DeploymentConfig } from "@tyrum/contracts";
import { DeploymentConfigDal } from "./modules/config/deployment-config-dal.js";

interface ToolRunnerStdioRequest {
  tenant_id?: string;
  run_id?: string;
  step_id?: string;
  attempt_id?: string;
  approval_id?: string | null;
  agent_id?: string | null;
  key?: string;
  lane?: string;
  workspace_id?: string;
  policy_snapshot_id?: string | null;
  plan_id: string;
  step_index: number;
  timeout_ms?: number;
  action: unknown;
}

function readStdinUtf8(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", (err) => reject(err));
  });
}

function resolveGatewayHome(homeOverride?: string): string {
  const trimmed = homeOverride?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : join(homedir(), ".tyrum");
}

function resolveGatewayDbPath(home: string, dbOverride?: string): string {
  const trimmed = dbOverride?.trim();
  if (trimmed && trimmed.length > 0) return trimmed;
  return join(home, "gateway.db");
}

function resolveDefaultMigrationsDir(__dirname: string, dbPath: string): string {
  return isPostgresDbUri(dbPath)
    ? join(__dirname, "../migrations/postgres")
    : join(__dirname, "../migrations/sqlite");
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`missing/invalid ${field}`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`missing/invalid ${field}`);
  }
  return trimmed;
}

function readOptionalPolicySnapshotId(value: unknown): string | null {
  if (value === null || typeof value === "undefined") {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("missing/invalid policy_snapshot_id");
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildStepExecutionContext(request: ToolRunnerStdioRequest): StepExecutionContext {
  const tenantId = requireTenantIdValue(request.tenant_id, "missing/invalid tenant_id");
  return {
    tenantId,
    runId: requireNonEmptyString(request.run_id, "run_id"),
    stepId: requireNonEmptyString(request.step_id, "step_id"),
    attemptId: requireNonEmptyString(request.attempt_id, "attempt_id"),
    approvalId:
      request.approval_id === null || typeof request.approval_id === "undefined"
        ? null
        : requireNonEmptyString(request.approval_id, "approval_id"),
    agentId:
      request.agent_id === null || typeof request.agent_id === "undefined"
        ? null
        : requireNonEmptyString(request.agent_id, "agent_id"),
    key: requireNonEmptyString(request.key, "key"),
    lane: requireNonEmptyString(request.lane, "lane"),
    workspaceId: requireNonEmptyString(request.workspace_id, "workspace_id"),
    policySnapshotId: readOptionalPolicySnapshotId(request.policy_snapshot_id),
  };
}

export async function runToolRunnerFromStdio(params?: {
  home?: string;
  db?: string;
  migrationsDir?: string;
  payloadB64?: string;
}): Promise<number> {
  const logger = new Logger({ level: "silent", base: { service: "tyrum-toolrunner" } });
  const __dirname = dirname(fileURLToPath(import.meta.url));

  let request: ToolRunnerStdioRequest;
  try {
    const raw = (() => {
      const payloadB64 = params?.payloadB64?.trim();
      if (payloadB64) {
        try {
          return Buffer.from(payloadB64, "base64url").toString("utf-8").trim();
        } catch {
          return Buffer.from(payloadB64, "base64").toString("utf-8").trim();
        }
      }
      return "";
    })();
    const payload = raw.length > 0 ? raw : (await readStdinUtf8()).trim();
    const trimmed = payload.trim();
    if (!trimmed) {
      throw new Error("toolrunner expects a JSON request on stdin or --payload-b64");
    }
    request = JSON.parse(trimmed) as ToolRunnerStdioRequest;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`toolrunner input error: ${message}\n`);
    return 2;
  }

  let tenantId: string;
  let context: StepExecutionContext;
  const planId = typeof request.plan_id === "string" ? request.plan_id : "";
  const stepIndex = typeof request.step_index === "number" ? Math.floor(request.step_index) : -1;
  try {
    context = buildStepExecutionContext(request);
    tenantId = context.tenantId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "missing/invalid toolrunner context";
    process.stderr.write(`toolrunner input error: ${message}\n`);
    return 2;
  }
  if (!planId || stepIndex < 0) {
    process.stderr.write("toolrunner input error: missing/invalid plan_id or step_index\n");
    return 2;
  }

  const actionParse = ActionPrimitive.safeParse(request.action);
  if (!actionParse.success) {
    process.stderr.write(`toolrunner input error: invalid action: ${actionParse.error.message}\n`);
    return 2;
  }
  const action: ActionPrimitiveT = actionParse.data;

  const timeoutMsRaw = request.timeout_ms;
  const timeoutMs =
    typeof timeoutMsRaw === "number" && Number.isFinite(timeoutMsRaw)
      ? Math.max(1, Math.min(300_000, Math.floor(timeoutMsRaw)))
      : 60_000;

  const tyrumHome = resolveGatewayHome(params?.home);
  const dbPath = resolveGatewayDbPath(tyrumHome, params?.db);
  const migrationsDir =
    params?.migrationsDir?.trim() && params.migrationsDir.trim().length > 0
      ? params.migrationsDir.trim()
      : resolveDefaultMigrationsDir(__dirname, dbPath);

  let db: SqliteDb | PostgresDb | undefined;
  let executor: ReturnType<typeof createLocalStepExecutor> | undefined;
  try {
    const redactionEngine = new RedactionEngine();

    db = isPostgresDbUri(dbPath)
      ? await PostgresDb.open({ dbUri: dbPath, migrationsDir })
      : SqliteDb.open({ dbPath, migrationsDir });

    const deploymentConfigDal = new DeploymentConfigDal(db);
    const deployment = await deploymentConfigDal.ensureSeeded({
      defaultConfig: DeploymentConfig.parse({}),
      createdBy: { kind: "bootstrap.toolrunner" },
      reason: "seed",
    });
    const policyService = new PolicyService({
      home: tyrumHome,
      snapshotDal: new PolicySnapshotDal(db),
      overrideDal: new PolicyOverrideDal(db),
      logger,
      deploymentPolicy: deployment.config.policy,
    });

    const secretProvider = await createDbSecretProvider({
      db,
      dbPath,
      tyrumHome,
      tenantId,
    });
    const artifactStore = createArtifactStore(
      {
        ...deployment.config.artifacts,
        dir: deployment.config.artifacts.dir ?? join(tyrumHome, "artifacts"),
        s3: {
          ...deployment.config.artifacts.s3,
          bucket: deployment.config.artifacts.s3.bucket ?? "tyrum-artifacts",
          region: deployment.config.artifacts.s3.region ?? "us-east-1",
          forcePathStyle:
            deployment.config.artifacts.s3.forcePathStyle ??
            Boolean(deployment.config.artifacts.s3.endpoint),
        },
      },
      redactionEngine,
    );

    executor = createLocalStepExecutor({
      tyrumHome,
      secretProvider,
      policyService,
      isPolicyApprovalApproved: async (inputTenantId, approvalId) => {
        const approval = await db!.get<{ kind: string; status: string }>(
          "SELECT kind, status FROM approvals WHERE tenant_id = ? AND approval_id = ? LIMIT 1",
          [inputTenantId, approvalId],
        );
        return approval?.kind === "policy" && approval?.status === "approved";
      },
      redactionEngine,
      artifactStore,
      logger,
    });

    const result = await executor.execute(action, planId, stepIndex, timeoutMs, context);
    process.stdout.write(JSON.stringify(result) + "\n");
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("toolrunner.error", { error: message });
    process.stderr.write(`toolrunner error: ${message}\n`);
    return 1;
  } finally {
    await executor?.shutdown?.().catch(() => {});
    await db?.close().catch(() => {});
  }
}
