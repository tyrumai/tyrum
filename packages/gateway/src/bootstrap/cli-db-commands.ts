import { DEFAULT_PUBLIC_BASE_URL, DeploymentConfig } from "@tyrum/contracts";
import type { SqlDb } from "../statestore/types.js";
import { AuthTokenService } from "../modules/auth/auth-token-service.js";
import { DeploymentConfigDal } from "../modules/config/deployment-config-dal.js";
import { DEFAULT_TENANT_ID } from "../modules/identity/scope.js";
import {
  ensureDatabaseDirectory,
  openGatewayDb,
  resolveGatewayDbPath,
  resolveGatewayHome,
  resolveGatewayMigrationsDir,
} from "./config.js";

type DbCommand = {
  home?: string;
  db?: string;
  migrationsDir?: string;
};

async function closeCommandDb(db: SqlDb | undefined, label: string): Promise<void> {
  await db?.close().catch((closeErr) => {
    const message = closeErr instanceof Error ? closeErr.message : String(closeErr);
    console.error(`${label}: warning: failed to close db: ${message}`);
  });
}

export async function runGatewayCheck(cmd: DbCommand): Promise<number> {
  const tyrumHome = resolveGatewayHome(cmd.home);
  const dbPath = resolveGatewayDbPath(tyrumHome, cmd.db);
  const migrationsDir = resolveGatewayMigrationsDir(dbPath, cmd.migrationsDir);

  let db: SqlDb | undefined;
  try {
    ensureDatabaseDirectory(dbPath);
    db = await openGatewayDb({ dbPath, migrationsDir });

    const deploymentConfigDal = new DeploymentConfigDal(db);
    const deployment = await deploymentConfigDal.ensureSeeded({
      defaultConfig: DeploymentConfig.parse({
        server: { publicBaseUrl: DEFAULT_PUBLIC_BASE_URL },
      }),
      createdBy: { kind: "bootstrap.check" },
      reason: "seed",
    });

    const authTokens = new AuthTokenService(db);
    const systemTokens = await authTokens.countActiveSystemTokens();
    const defaultTenantTokens = await authTokens.countActiveTenantTokens(DEFAULT_TENANT_ID);

    console.log("check: ok");
    console.log(`db: kind=${db.kind} path=${dbPath}`);
    console.log(
      `deployment_config: revision=${deployment.revision} sha256=${deployment.configSha256.slice(0, 12)}`,
    );
    console.log(
      `auth_tokens: system=${String(systemTokens)} default_tenant=${String(defaultTenantTokens)}`,
    );
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`check: failed: ${message}`);
    return 1;
  } finally {
    await closeCommandDb(db, "check");
  }
}

export async function runIssueDefaultTenantAdminToken(cmd: DbCommand): Promise<number> {
  const tyrumHome = resolveGatewayHome(cmd.home);
  const dbPath = resolveGatewayDbPath(tyrumHome, cmd.db);
  const migrationsDir = resolveGatewayMigrationsDir(dbPath, cmd.migrationsDir);

  let db: SqlDb | undefined;
  try {
    ensureDatabaseDirectory(dbPath);
    db = await openGatewayDb({ dbPath, migrationsDir });

    const authTokens = new AuthTokenService(db);
    const issued = await authTokens.issueToken({
      tenantId: DEFAULT_TENANT_ID,
      role: "admin",
      scopes: ["*"],
      createdByJson: JSON.stringify({
        kind: "bootstrap.recovery_cli",
      }),
    });

    console.log("tokens.issue-default-tenant-admin: ok");
    console.log(`db: kind=${db.kind} path=${dbPath}`);
    console.log(`default-tenant-admin: ${issued.token}`);
    console.log("Keep this token secure. It is shown only once by this command.");
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`tokens.issue-default-tenant-admin: failed: ${message}`);
    return 1;
  } finally {
    await closeCommandDb(db, "tokens.issue-default-tenant-admin");
  }
}
