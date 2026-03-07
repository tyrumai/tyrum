import { stat } from "node:fs/promises";
import { join } from "node:path";
import { DeploymentConfig } from "@tyrum/schemas";
import type { SqlDb } from "../statestore/types.js";
import { createArtifactStore } from "../modules/artifact/create-artifact-store.js";
import { DeploymentConfigDal } from "../modules/config/deployment-config-dal.js";
import { DEFAULT_TENANT_ID, IdentityScopeDal } from "../modules/identity/scope.js";
import { Logger } from "../modules/observability/logger.js";
import { RedactionEngine } from "../modules/redaction/engine.js";
import { importLocalHomeToSharedState } from "../modules/runtime-state/import-local-home.js";
import {
  ensureDatabaseDirectory,
  openGatewayDb,
  resolveGatewayDbPath,
  resolveGatewayHome,
  resolveGatewayMigrationsDir,
} from "./config.js";

export async function runImportHome(cmd: {
  source_home: string;
  tenantId?: string;
  home?: string;
  db?: string;
  migrationsDir?: string;
}): Promise<number> {
  const sourceHome = cmd.source_home.trim();
  const tenantId = cmd.tenantId?.trim() || DEFAULT_TENANT_ID;
  const targetHome = resolveGatewayHome(cmd.home);
  const dbPath = resolveGatewayDbPath(targetHome, cmd.db);
  const migrationsDir = resolveGatewayMigrationsDir(dbPath, cmd.migrationsDir);

  let db: SqlDb | undefined;
  try {
    const sourceStats = await stat(sourceHome);
    if (!sourceStats.isDirectory()) {
      throw new Error(`source home is not a directory: ${sourceHome}`);
    }

    ensureDatabaseDirectory(dbPath);
    db = await openGatewayDb({ dbPath, migrationsDir });

    const deploymentConfigDal = new DeploymentConfigDal(db);
    const deployment = await deploymentConfigDal.ensureSeeded({
      defaultConfig: DeploymentConfig.parse({}),
      createdBy: { kind: "cli.import_home" },
      reason: "seed",
    });

    const redactionEngine = new RedactionEngine();
    const artifactStore = createArtifactStore(
      {
        ...deployment.config.artifacts,
        dir: deployment.config.artifacts.dir ?? join(targetHome, "artifacts"),
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

    const summary = await importLocalHomeToSharedState({
      sourceHome,
      tenantId,
      identityScopeDal: new IdentityScopeDal(db),
      artifactStore,
      db,
      logger: new Logger({ level: "info", base: { service: "tyrum-gateway" } }),
      createdBy: { kind: "cli.import_home" },
      reason: `import-home:${sourceHome}`,
    });

    console.log("import-home: ok");
    console.log(`tenant_id=${summary.tenantId}`);
    console.log(`agents=${String(summary.agents)} identities=${String(summary.identities)}`);
    console.log(
      `skills=${String(summary.skills)} mcp_servers=${String(summary.mcpServers)} plugins=${String(summary.plugins)}`,
    );
    console.log(
      `hooks=${String(summary.hooks)} deployment_policy=${String(summary.deploymentPolicyImported)} agent_policies=${String(summary.agentPolicies)}`,
    );
    console.log(`markdown_docs=${String(summary.markdownDocs)}`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`import-home: failed: ${message}`);
    return 1;
  } finally {
    await db?.close().catch((closeErr) => {
      const message = closeErr instanceof Error ? closeErr.message : String(closeErr);
      console.error(`import-home: warning: failed to close db: ${message}`);
    });
  }
}
