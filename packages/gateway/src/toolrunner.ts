import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/schemas";
import { ActionPrimitive } from "@tyrum/schemas";
import { homedir } from "node:os";
import { join } from "node:path";
import { TokenStore } from "./modules/auth/token-store.js";
import { EnvSecretProvider, FileSecretProvider, KeychainSecretProvider } from "./modules/secret/provider.js";
import type { SecretProvider } from "./modules/secret/provider.js";
import { createLocalStepExecutor } from "./modules/execution/local-step-executor.js";
import { RedactionEngine } from "./modules/redaction/engine.js";
import type { ArtifactStore } from "./modules/artifact/store.js";
import { FsArtifactStore, S3ArtifactStore } from "./modules/artifact/store.js";
import { S3Client } from "@aws-sdk/client-s3";
import { Logger } from "./modules/observability/logger.js";

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

function createArtifactStore(
  tyrumHome: string,
  redactionEngine: RedactionEngine,
): ArtifactStore {
  const kind = process.env["TYRUM_ARTIFACT_STORE"]?.trim() || "fs";
  const fsDir =
    process.env["TYRUM_ARTIFACTS_DIR"]?.trim() || join(tyrumHome, "artifacts");

  if (kind === "s3") {
    const bucket =
      process.env["TYRUM_ARTIFACTS_S3_BUCKET"]?.trim() || "tyrum-artifacts";
    const region =
      process.env["TYRUM_ARTIFACTS_S3_REGION"]?.trim() || "us-east-1";
    const endpoint = process.env["TYRUM_ARTIFACTS_S3_ENDPOINT"]?.trim() || undefined;
    const forcePathStyleRaw =
      process.env["TYRUM_ARTIFACTS_S3_FORCE_PATH_STYLE"]?.trim();
    const forcePathStyle =
      forcePathStyleRaw !== undefined
        ? forcePathStyleRaw === "1" || forcePathStyleRaw.toLowerCase() === "true"
        : endpoint !== undefined;

    const accessKeyId =
      process.env["TYRUM_ARTIFACTS_S3_ACCESS_KEY_ID"]?.trim() || undefined;
    const secretAccessKey =
      process.env["TYRUM_ARTIFACTS_S3_SECRET_ACCESS_KEY"]?.trim() || undefined;
    const sessionToken =
      process.env["TYRUM_ARTIFACTS_S3_SESSION_TOKEN"]?.trim() || undefined;

    const client = new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey, sessionToken }
          : undefined,
    });
    return new S3ArtifactStore(client, bucket, "artifacts", redactionEngine);
  }

  return new FsArtifactStore(fsDir, redactionEngine);
}

async function createSecretProvider(
  tyrumHome: string,
  token: string | undefined,
): Promise<SecretProvider> {
  const desiredProvider = process.env["TYRUM_SECRET_PROVIDER"]?.trim().toLowerCase();
  const isKubernetes = Boolean(process.env["KUBERNETES_SERVICE_HOST"]);
  const providerKind =
    desiredProvider === "env" || desiredProvider === "file" || desiredProvider === "keychain"
      ? desiredProvider
      : (isKubernetes ? "env" : "file");

  if (providerKind === "env") {
    return new EnvSecretProvider();
  }
  if (providerKind === "keychain") {
    const secretsPath = join(tyrumHome, "secrets.keychain.json");
    return await KeychainSecretProvider.create(secretsPath);
  }

  if (!token || token.trim().length === 0) {
    throw new Error("FileSecretProvider requires a non-empty admin token");
  }
  const secretsPath = join(tyrumHome, "secrets.json");
  return await FileSecretProvider.create(secretsPath, token);
}

export async function runToolRunnerFromStdio(): Promise<number> {
  const logger = new Logger({ base: { service: "tyrum-toolrunner" } });

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
  const timeoutMs = typeof timeoutMsRaw === "number" && Number.isFinite(timeoutMsRaw)
    ? Math.max(1, Math.min(300_000, Math.floor(timeoutMsRaw)))
    : 60_000;

  const tyrumHome =
    process.env["TYRUM_HOME"]?.trim() || join(homedir(), ".tyrum");

  try {
    const redactionEngine = new RedactionEngine();
    const tokenStore = new TokenStore(tyrumHome);
    const token = await tokenStore.initialize();
    const secretProvider = await createSecretProvider(tyrumHome, token);
    const artifactStore = createArtifactStore(tyrumHome, redactionEngine);

    const executor = createLocalStepExecutor({
      tyrumHome,
      secretProvider,
      redactionEngine,
      artifactStore,
      logger,
    });

    const result = await executor.execute(action, planId, stepIndex, timeoutMs);
    process.stdout.write(JSON.stringify(result) + "\n");
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("toolrunner.error", { error: message });
    process.stderr.write(`toolrunner error: ${message}\n`);
    return 1;
  }
}

