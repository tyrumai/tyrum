import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentConfig, DeploymentConfig } from "@tyrum/schemas";
import type { GatewayContainer } from "../container.js";
import type { SqlDb } from "../statestore/types.js";
import { AgentConfigDal } from "../modules/config/agent-config-dal.js";
import { isPostgresDbUri } from "../statestore/db-uri.js";
import { SqliteDb } from "../statestore/sqlite.js";
import { PostgresDb } from "../statestore/postgres.js";
import type { GatewayRole } from "./network.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type GatewayStartOptions = {
  role?: GatewayRole;
  home?: string;
  db?: string;
  host?: string;
  port?: number;
  migrationsDir?: string;
  allowInsecureHttp?: boolean;
  engineApiEnabled?: boolean;
  snapshotImportEnabled?: boolean;
};

export type StartCommandOverrides = Pick<
  GatewayStartOptions,
  "allowInsecureHttp" | "engineApiEnabled" | "snapshotImportEnabled"
>;

export function assertSplitRoleUsesPostgres(role: GatewayRole, dbPath: string): void {
  if (role === "all") return;
  if (isPostgresDbUri(dbPath)) return;
  throw new Error(
    `role '${role}' requires Postgres (set --db to a postgres:// URI). ` +
      `Use 'all' for single-process SQLite deployments.`,
  );
}

export function ensureDatabaseDirectory(dbPath: string): void {
  const trimmed = dbPath.trim();
  if (trimmed.length === 0) return;
  if (trimmed === ":memory:") return;
  if (/^file:/i.test(trimmed)) return;
  if (isPostgresDbUri(trimmed)) return;

  const parentDir = dirname(trimmed);
  if (parentDir === "." || parentDir === "") return;

  try {
    mkdirSync(parentDir, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to create database directory "${parentDir}" for db path "${dbPath}": ${message}`,
    );
  }
}

export function resolveGatewayHome(homeOverride?: string): string {
  const trimmed = homeOverride?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : join(homedir(), ".tyrum");
}

export function resolveGatewayDbPath(home: string, dbOverride?: string): string {
  const trimmed = dbOverride?.trim();
  if (trimmed && trimmed.length > 0) return trimmed;
  return join(home, "gateway.db");
}

export function resolveGatewayHost(hostOverride?: string): string {
  const trimmed = hostOverride?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "127.0.0.1";
}

export function resolveGatewayPort(portOverride?: number): number {
  if (typeof portOverride === "number" && Number.isFinite(portOverride)) {
    const parsed = Math.floor(portOverride);
    if (parsed >= 1 && parsed <= 65535) return parsed;
  }
  return 8788;
}

export function resolveDefaultMigrationsDirForBaseDir(
  baseDir: string,
  dbPath: string,
  pathExists: (path: string) => boolean = existsSync,
): string {
  const dialectDir = isPostgresDbUri(dbPath) ? "postgres" : "sqlite";
  const candidates = [
    join(baseDir, "../migrations", dialectDir),
    join(baseDir, "../../migrations", dialectDir),
  ];

  for (const candidate of candidates) {
    if (pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0]!;
}

function resolveDefaultMigrationsDir(dbPath: string): string {
  return resolveDefaultMigrationsDirForBaseDir(__dirname, dbPath);
}

export function resolveGatewayMigrationsDir(dbPath: string, override?: string): string {
  const trimmed = override?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : resolveDefaultMigrationsDir(dbPath);
}

function resolveTruthyEnvFlag(name: string): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string") return false;

  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      return false;
  }
}

export function resolveSnapshotImportEnabled(snapshotImportOverride?: boolean): boolean {
  return Boolean(snapshotImportOverride) || resolveTruthyEnvFlag("TYRUM_SNAPSHOT_IMPORT_ENABLED");
}

export function buildStartupDefaultDeploymentConfig(
  overrides: StartCommandOverrides,
): DeploymentConfig {
  return DeploymentConfig.parse({
    server: {
      allowInsecureHttp: Boolean(overrides.allowInsecureHttp),
    },
    execution: {
      engineApiEnabled: Boolean(overrides.engineApiEnabled),
    },
    snapshots: {
      importEnabled: resolveSnapshotImportEnabled(overrides.snapshotImportEnabled),
    },
  });
}

export function applyStartCommandDeploymentOverrides(
  deploymentConfig: DeploymentConfig,
  overrides: StartCommandOverrides,
): DeploymentConfig {
  return DeploymentConfig.parse({
    ...deploymentConfig,
    server: {
      ...deploymentConfig.server,
      allowInsecureHttp:
        deploymentConfig.server.allowInsecureHttp || Boolean(overrides.allowInsecureHttp),
    },
    execution: {
      ...deploymentConfig.execution,
      engineApiEnabled:
        deploymentConfig.execution.engineApiEnabled || Boolean(overrides.engineApiEnabled),
    },
    snapshots: {
      ...deploymentConfig.snapshots,
      importEnabled:
        deploymentConfig.snapshots.importEnabled || Boolean(overrides.snapshotImportEnabled),
    },
  });
}

export async function openGatewayDb(params: {
  dbPath: string;
  migrationsDir: string;
}): Promise<SqlDb> {
  const dbPath = params.dbPath.trim();
  if (isPostgresDbUri(dbPath)) {
    return await PostgresDb.open({ dbUri: dbPath, migrationsDir: params.migrationsDir });
  }
  return SqliteDb.open({ dbPath, migrationsDir: params.migrationsDir });
}

export async function seedDefaultAgentConfig(container: GatewayContainer): Promise<void> {
  const defaultScope = await container.identityScopeDal.resolveScopeIds();
  await new AgentConfigDal(container.db).ensureSeeded({
    tenantId: defaultScope.tenantId,
    agentId: defaultScope.agentId,
    defaultConfig: AgentConfig.parse({
      model: { model: "openai/gpt-4.1" },
      tools: { allow: ["tool.fs.read"] },
    }),
    createdBy: { kind: "bootstrap" },
    reason: "seed",
  });
}
