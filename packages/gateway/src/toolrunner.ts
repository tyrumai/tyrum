import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/schemas";
import { ActionPrimitive } from "@tyrum/schemas";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDbSecretProvider } from "./modules/secret/create-secret-provider.js";
import { createLocalStepExecutor } from "./modules/execution/local-step-executor.js";
import type { StepExecutionContext } from "./modules/execution/engine.js";
import { DEFAULT_TENANT_ID } from "./modules/identity/scope.js";
import { RedactionEngine } from "./modules/redaction/engine.js";
import { createArtifactStoreFromEnv } from "./modules/artifact/create-artifact-store.js";
import { Logger } from "./modules/observability/logger.js";
import { SqliteDb } from "./statestore/sqlite.js";
import { PostgresDb } from "./statestore/postgres.js";
import { isPostgresDbUri } from "./statestore/db-uri.js";

interface ToolRunnerStdioRequest {
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

export async function runToolRunnerFromStdio(): Promise<number> {
  const logger = new Logger({ base: { service: "tyrum-toolrunner" } });
  const __dirname = dirname(fileURLToPath(import.meta.url));

  let request: ToolRunnerStdioRequest;
  try {
    const envPayload = process.env["TYRUM_TOOLRUNNER_PAYLOAD"]?.trim();
    const raw = envPayload && envPayload.length > 0 ? envPayload : (await readStdinUtf8()).trim();
    if (!raw) {
      throw new Error("toolrunner expects a JSON request on stdin or TYRUM_TOOLRUNNER_PAYLOAD");
    }
    request = JSON.parse(raw) as ToolRunnerStdioRequest;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`toolrunner input error: ${message}\n`);
    return 2;
  }

  const planId = typeof request.plan_id === "string" ? request.plan_id : "";
  const stepIndex = typeof request.step_index === "number" ? Math.floor(request.step_index) : -1;
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

  const tyrumHome = process.env["TYRUM_HOME"]?.trim() || join(homedir(), ".tyrum");

  let db: SqliteDb | PostgresDb | undefined;
  try {
    const redactionEngine = new RedactionEngine();
    const dbPath = process.env["GATEWAY_DB_PATH"]?.trim() || "gateway.db";
    const migrationsDir =
      process.env["GATEWAY_MIGRATIONS_DIR"]?.trim() ||
      join(__dirname, "../migrations", isPostgresDbUri(dbPath) ? "postgres" : "sqlite");

    db = isPostgresDbUri(dbPath)
      ? await PostgresDb.open({ dbUri: dbPath, migrationsDir })
      : SqliteDb.open({ dbPath, migrationsDir });

    const secretProvider = await createDbSecretProvider({ db, dbPath, tyrumHome });
    const artifactStore = createArtifactStoreFromEnv(tyrumHome, redactionEngine);

    const executor = createLocalStepExecutor({
      tyrumHome,
      secretProvider,
      redactionEngine,
      artifactStore,
      logger,
    });

    const context: StepExecutionContext = {
      tenantId: DEFAULT_TENANT_ID,
      runId: "toolrunner",
      stepId: `toolrunner:${planId}:${String(stepIndex)}`,
      attemptId: "toolrunner",
      approvalId: null,
      key: "toolrunner",
      lane: "toolrunner",
      workspaceId: "default",
      policySnapshotId: null,
    };

    const result = await executor.execute(action, planId, stepIndex, timeoutMs, context);
    process.stdout.write(JSON.stringify(result) + "\n");
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("toolrunner.error", { error: message });
    process.stderr.write(`toolrunner error: ${message}\n`);
    return 1;
  } finally {
    await db?.close().catch(() => {});
  }
}
